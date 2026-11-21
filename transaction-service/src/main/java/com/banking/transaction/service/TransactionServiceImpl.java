package com.banking.transaction.service;

import com.banking.common.dto.PagedResponse;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.CurrentUser;
import com.banking.common.util.MoneyUtil;
import com.banking.transaction.dto.request.DepositRequest;
import com.banking.transaction.dto.request.TransferRequest;
import com.banking.transaction.dto.response.SagaStateResponse;
import com.banking.transaction.dto.response.TransactionResponse;
import com.banking.transaction.dto.response.TransactionStatusResponse;
import com.banking.transaction.entity.SagaState;
import com.banking.transaction.entity.Transaction;
import com.banking.transaction.entity.TransactionStatus;
import com.banking.transaction.entity.TransactionType;
import com.banking.transaction.exception.TransactionNotFoundException;
import com.banking.transaction.mapper.TransactionMapper;
import com.banking.transaction.repository.SagaStateRepository;
import com.banking.transaction.repository.TransactionRepository;
import com.banking.transaction.repository.TransactionSpecifications;
import com.banking.transaction.repository.TransactionStatusHistoryRepository;
import com.banking.transaction.saga.TransactionSagaOrchestrator;
import com.banking.transaction.util.TransactionReferenceGenerator;
import com.banking.transaction.validation.TransactionValidator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * Default {@link TransactionService}.
 * <p>
 * Creating: validate -> honour Idempotency-Key -> build the entity -> hand it to the
 * {@link TransactionSagaOrchestrator}, which saves it and starts the saga.
 * Reading: load and check that the caller owns the transaction (or is an admin).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TransactionServiceImpl implements TransactionService {

    static final int DEFAULT_PAGE_SIZE = 20;
    static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_IDEMPOTENCY_KEY_LENGTH = 100;
    private static final int MAX_COUNTRY_LENGTH = 8;
    private static final int MAX_REFERENCE_ATTEMPTS = 5;

    private final TransactionRepository transactionRepository;
    private final TransactionStatusHistoryRepository historyRepository;
    private final SagaStateRepository sagaStateRepository;
    private final TransactionSagaOrchestrator sagaOrchestrator;
    private final TransactionValidator validator;
    private final TransactionReferenceGenerator referenceGenerator;
    private final TransactionMapper mapper;

    // ------------------------------------------------------------------ create

    @Override
    @Transactional
    public TransactionResponse deposit(DepositRequest request, String idempotencyKey, String clientCountry) {
        return initiate(TransactionType.DEPOSIT, null, request.accountId(), request.amount(),
                request.currency(), request.description(), idempotencyKey, clientCountry);
    }

    @Override
    @Transactional
    public TransactionResponse withdraw(DepositRequest request, String idempotencyKey, String clientCountry) {
        return initiate(TransactionType.WITHDRAWAL, request.accountId(), null, request.amount(),
                request.currency(), request.description(), idempotencyKey, clientCountry);
    }

    @Override
    @Transactional
    public TransactionResponse transfer(TransferRequest request, String idempotencyKey, String clientCountry) {
        return initiate(TransactionType.TRANSFER, request.sourceAccountId(), request.destinationAccountId(),
                request.amount(), request.currency(), request.description(), idempotencyKey, clientCountry);
    }

    private TransactionResponse initiate(TransactionType type, String sourceAccountId, String destinationAccountId,
                                         BigDecimal amount, String currency, String description,
                                         String idempotencyKey, String clientCountry) {
        AuthenticatedUser user = CurrentUser.require();
        String key = normalizeIdempotencyKey(idempotencyKey);

        if (key != null) {
            Optional<Transaction> existing = transactionRepository.findByInitiatedByAndIdempotencyKey(user.userId(), key);
            if (existing.isPresent()) {
                log.info("Idempotency-Key {} reused by {}: returning existing transaction {}",
                        key, user.userId(), existing.get().getReference());
                return mapper.toResponse(existing.get());
            }
        }

        validator.validate(type, sourceAccountId, destinationAccountId, amount);
        String resolvedCurrency = validator.resolveCurrency(currency);

        Transaction transaction = Transaction.builder()
                .id(UUID.randomUUID())
                .reference(newUniqueReference())
                .transactionType(type)
                .status(TransactionStatus.PENDING)
                .sourceAccountId(trimToNull(sourceAccountId))
                .destinationAccountId(trimToNull(destinationAccountId))
                .amount(MoneyUtil.normalize(amount))
                .currency(resolvedCurrency)
                .description(trimToNull(description))
                .initiatedBy(user.userId())
                .idempotencyKey(key)
                .clientCountry(normalizeCountry(clientCountry))
                .correlationId(UUID.randomUUID().toString())
                .build();

        Transaction saved = sagaOrchestrator.startSaga(transaction);
        return mapper.toResponse(saved);
    }

    // ------------------------------------------------------------------ read

    @Override
    @Transactional(readOnly = true)
    public TransactionResponse getTransaction(UUID id) {
        return mapper.toResponse(findOwned(id));
    }

    @Override
    @Transactional(readOnly = true)
    public TransactionResponse getTransactionByReference(String reference) {
        Transaction tx = transactionRepository.findByReference(reference)
                .orElseThrow(() -> new TransactionNotFoundException(reference));
        CurrentUser.requireOwnerOrAdmin(tx.getInitiatedBy());
        return mapper.toResponse(tx);
    }

    @Override
    @Transactional(readOnly = true)
    public PagedResponse<TransactionResponse> listTransactions(String accountId, TransactionStatus status,
                                                               TransactionType type, int page, int size) {
        AuthenticatedUser user = CurrentUser.require();
        String owner = user.isAdmin() ? null : user.userId();

        Specification<Transaction> spec = Specification.where(TransactionSpecifications.initiatedBy(owner))
                .and(TransactionSpecifications.involvesAccount(trimToNull(accountId)))
                .and(TransactionSpecifications.hasStatus(status))
                .and(TransactionSpecifications.hasType(type));

        PageRequest pageRequest = PageRequest.of(Math.max(page, 0), clampSize(size),
                Sort.by(Sort.Direction.DESC, "createdAt"));
        Page<Transaction> result = transactionRepository.findAll(spec, pageRequest);
        return PagedResponse.from(result, mapper::toResponse);
    }

    @Override
    @Transactional(readOnly = true)
    public TransactionStatusResponse getTransactionStatus(UUID id) {
        Transaction tx = findOwned(id);
        return mapper.toStatusResponse(tx, historyRepository.findByTransactionIdOrderByChangedAtAscIdAsc(id));
    }

    @Override
    @Transactional(readOnly = true)
    public SagaStateResponse getSagaState(UUID transactionId) {
        SagaState saga = sagaStateRepository.findByTransactionId(transactionId)
                .orElseThrow(() -> new TransactionNotFoundException(transactionId.toString()));
        return mapper.toSagaResponse(saga);
    }

    // ------------------------------------------------------------------ helpers

    private Transaction findOwned(UUID id) {
        Transaction tx = transactionRepository.findById(id)
                .orElseThrow(() -> new TransactionNotFoundException(id.toString()));
        CurrentUser.requireOwnerOrAdmin(tx.getInitiatedBy());
        return tx;
    }

    private String newUniqueReference() {
        for (int i = 0; i < MAX_REFERENCE_ATTEMPTS; i++) {
            String reference = referenceGenerator.generate();
            if (!transactionRepository.existsByReference(reference)) {
                return reference;
            }
        }
        throw new BankingException(ErrorCode.INTERNAL_ERROR, "Could not generate a unique transaction reference");
    }

    private static String normalizeIdempotencyKey(String key) {
        String trimmed = trimToNull(key);
        if (trimmed != null && trimmed.length() > MAX_IDEMPOTENCY_KEY_LENGTH) {
            throw new BankingException(ErrorCode.BAD_REQUEST,
                    "Idempotency-Key must be at most " + MAX_IDEMPOTENCY_KEY_LENGTH + " characters");
        }
        return trimmed;
    }

    /** Upper-cased country code from the header, or null if missing / implausible. */
    private static String normalizeCountry(String country) {
        String trimmed = trimToNull(country);
        if (trimmed == null || trimmed.length() > MAX_COUNTRY_LENGTH) {
            return null;
        }
        return trimmed.toUpperCase(Locale.ROOT);
    }

    static int clampSize(int size) {
        if (size <= 0) {
            return DEFAULT_PAGE_SIZE;
        }
        return Math.min(size, MAX_PAGE_SIZE);
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}

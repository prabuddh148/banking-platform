package com.banking.account.service;

import com.banking.account.dto.request.ReserveBalanceRequest;
import com.banking.account.dto.response.AccountBalanceResponse;
import com.banking.account.entity.Account;
import com.banking.account.entity.AccountBalance;
import com.banking.account.entity.BalanceReservation;
import com.banking.account.entity.BalanceUpdateOutcome;
import com.banking.account.entity.ProcessedTransaction;
import com.banking.account.entity.ReservationStatus;
import com.banking.account.entity.TransactionType;
import com.banking.account.event.BalanceUpdateFailedEvent;
import com.banking.account.event.BalanceUpdateRequestedEvent;
import com.banking.account.event.BalanceUpdatedEvent;
import com.banking.account.exception.AccountNotFoundException;
import com.banking.account.mapper.AccountMapper;
import com.banking.account.producer.AccountEventProducer;
import com.banking.account.repository.AccountBalanceRepository;
import com.banking.account.repository.BalanceReservationRepository;
import com.banking.account.repository.ProcessedTransactionRepository;
import com.banking.account.validation.AccountValidator;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.banking.common.security.CurrentUser;
import com.banking.common.util.MoneyUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.TreeSet;
import java.util.UUID;

/**
 * Default {@link AccountBalanceService}.
 *
 * <h2>How a balance update stays correct</h2>
 * <ol>
 *   <li><b>Idempotent</b>: a {@link ProcessedTransaction} row per transactionId. If it already
 *       exists the request is a re-delivery and is skipped.</li>
 *   <li><b>No lost updates</b>: balance rows are read with {@code SELECT ... FOR UPDATE}; two
 *       transfers touching the same account run one after the other.</li>
 *   <li><b>No deadlocks</b>: when two accounts are involved they are always locked in the same
 *       order (sorted by id), whatever the direction of the transfer.</li>
 *   <li><b>All-or-nothing</b>: every rule is checked BEFORE any balance is modified. On a
 *       business failure nothing changes; we record the failure and queue BALANCE_UPDATE_FAILED.
 *       On success the debit, credit, ledger row and BALANCE_UPDATED outbox row commit together.</li>
 * </ol>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AccountBalanceServiceImpl implements AccountBalanceService {

    private final AccountBalanceRepository balanceRepository;
    private final BalanceReservationRepository reservationRepository;
    private final ProcessedTransactionRepository processedTransactionRepository;
    private final AccountValidator accountValidator;
    private final AccountEventProducer eventProducer;
    private final AccountMapper accountMapper;

    // ------------------------------------------------------------------ REST operations

    @Override
    @Transactional(readOnly = true)
    public AccountBalanceResponse getBalance(UUID accountId) {
        AccountBalance balance = balanceRepository.findWithAccountById(accountId)
                .orElseThrow(() -> new AccountNotFoundException(accountId.toString()));
        CurrentUser.requireOwnerOrAdmin(balance.getAccount().getCustomerId());
        return accountMapper.toBalanceResponse(balance);
    }

    @Override
    @Transactional
    public AccountBalanceResponse reserve(UUID accountId, ReserveBalanceRequest request) {
        AccountBalance balance = lockBalance(accountId);
        Account account = balance.getAccount();
        BigDecimal amount = MoneyUtil.normalize(request.getAmount());
        String transactionId = request.getTransactionId().trim();

        accountValidator.requirePositiveAmount(amount);
        accountValidator.requireActive(account);
        if (reservationRepository.findByAccountIdAndTransactionId(accountId, transactionId).isPresent()) {
            throw new BankingException(ErrorCode.DUPLICATE_TRANSACTION,
                    "A reservation for transaction " + transactionId + " already exists on this account");
        }
        accountValidator.requireSufficientFunds(balance, amount, MoneyUtil.ZERO);

        balance.reserve(amount);
        balanceRepository.save(balance);
        reservationRepository.save(BalanceReservation.builder()
                .accountId(accountId)
                .transactionId(transactionId)
                .amount(amount)
                .status(ReservationStatus.ACTIVE)
                .build());
        log.info("Reserved {} {} on account {} for transaction {}", amount, balance.getCurrency(), accountId,
                transactionId);
        return accountMapper.toBalanceResponse(balance);
    }

    @Override
    @Transactional
    public AccountBalanceResponse release(UUID accountId, ReserveBalanceRequest request) {
        AccountBalance balance = lockBalance(accountId);
        String transactionId = request.getTransactionId().trim();
        BalanceReservation reservation = reservationRepository
                .findByAccountIdAndTransactionIdAndStatus(accountId, transactionId, ReservationStatus.ACTIVE)
                .orElseThrow(() -> new BankingException(ErrorCode.NOT_FOUND,
                        "No active reservation for transaction " + transactionId + " on this account"));
        BigDecimal amount = MoneyUtil.normalize(request.getAmount());
        if (amount.compareTo(MoneyUtil.normalize(reservation.getAmount())) != 0) {
            throw new BankingException(ErrorCode.BAD_REQUEST,
                    "Release amount must equal the reserved amount " + MoneyUtil.normalize(reservation.getAmount()));
        }

        balance.release(reservation.getAmount());
        reservation.setStatus(ReservationStatus.RELEASED);
        reservation.setClosedAt(Instant.now());
        balanceRepository.save(balance);
        reservationRepository.save(reservation);
        log.info("Released {} on account {} for transaction {}", amount, accountId, transactionId);
        return accountMapper.toBalanceResponse(balance);
    }

    // ------------------------------------------------------------------ saga step (Kafka)

    @Override
    @Transactional
    public BalanceUpdateOutcome applyBalanceUpdate(BalanceUpdateRequestedEvent event) {
        String transactionId = event.getTransactionId();
        if (!StringUtils.hasText(transactionId)) {
            // Malformed message: let the consumer's error handler send it to the DLT.
            throw new IllegalArgumentException("BALANCE_UPDATE_REQUESTED without transactionId (event "
                    + event.getEventId() + ")");
        }
        if (processedTransactionRepository.existsById(transactionId)) {
            log.info("Transaction {} already processed - ignoring duplicate delivery", transactionId);
            return null;
        }

        ProcessedTransaction.ProcessedTransactionBuilder ledger = ProcessedTransaction.builder()
                .transactionId(transactionId)
                .transactionType(event.getTransactionType())
                .amount(event.getAmount() == null ? null : MoneyUtil.normalize(event.getAmount()));
        try {
            BalanceUpdatedEvent updated = moveMoney(event, ledger);
            processedTransactionRepository.save(ledger.outcome(BalanceUpdateOutcome.SUCCEEDED).build());
            eventProducer.publish(updated, AccountEventProducer.AGGREGATE_TRANSACTION);
            log.info("Balance update for transaction {} ({}) succeeded", transactionId, event.getTransactionType());
            return BalanceUpdateOutcome.SUCCEEDED;
        } catch (BankingException ex) {
            // Business rule broken. moveMoney checks everything before changing any balance,
            // so nothing has been modified: record the failure and tell the saga.
            processedTransactionRepository.save(ledger
                    .outcome(BalanceUpdateOutcome.FAILED)
                    .errorCode(ex.getErrorCode().name())
                    .build());
            eventProducer.publish(BalanceUpdateFailedEvent.builder()
                    .transactionId(transactionId)
                    .reason(ex.getMessage())
                    .errorCode(ex.getErrorCode().name())
                    .correlationId(event.getCorrelationId())
                    .build(), AccountEventProducer.AGGREGATE_TRANSACTION);
            log.warn("Balance update for transaction {} failed: {} - {}", transactionId, ex.getErrorCode(),
                    ex.getMessage());
            return BalanceUpdateOutcome.FAILED;
        }
    }

    /**
     * Validates and applies the debit/credit. Throws {@link BankingException} on any business
     * problem — always before the first balance modification.
     */
    private BalanceUpdatedEvent moveMoney(BalanceUpdateRequestedEvent event,
                                          ProcessedTransaction.ProcessedTransactionBuilder ledger) {
        TransactionType type = parseType(event.getTransactionType());
        accountValidator.requirePositiveAmount(event.getAmount());
        BigDecimal amount = MoneyUtil.normalize(event.getAmount());

        UUID sourceId = type == TransactionType.DEPOSIT ? null : parseAccountId(event.getSourceAccountId(), "source");
        UUID destinationId = type == TransactionType.WITHDRAWAL
                ? null : parseAccountId(event.getDestinationAccountId(), "destination");
        if (sourceId != null && sourceId.equals(destinationId)) {
            throw new BankingException(ErrorCode.INVALID_TRANSACTION, "Source and destination account are the same");
        }
        ledger.sourceAccountId(sourceId).destinationAccountId(destinationId);

        Map<UUID, AccountBalance> locked = lockInOrder(sourceId, destinationId);
        AccountBalance source = sourceId == null ? null : locked.get(sourceId);
        AccountBalance destination = destinationId == null ? null : locked.get(destinationId);

        // ---- 1. validate everything (no changes yet)
        Optional<BalanceReservation> hold = Optional.empty();
        if (source != null) {
            Account sourceAccount = source.getAccount();
            accountValidator.requireActive(sourceAccount);
            accountValidator.requireCurrency(sourceAccount, event.getCurrency());
            accountValidator.requireOwner(sourceAccount, event.getInitiatedBy());
            // Money already held for this transaction counts as spendable for it.
            hold = reservationRepository.findByAccountIdAndTransactionIdAndStatus(
                    sourceId, event.getTransactionId(), ReservationStatus.ACTIVE);
            BigDecimal held = hold.map(BalanceReservation::getAmount).orElse(MoneyUtil.ZERO);
            accountValidator.requireSufficientFunds(source, amount, held);
        }
        if (destination != null) {
            Account destinationAccount = destination.getAccount();
            accountValidator.requireActive(destinationAccount);
            accountValidator.requireCurrency(destinationAccount, event.getCurrency());
        }

        // ---- 2. apply (cannot fail on business rules any more)
        if (source != null) {
            hold.ifPresent(reservation -> {
                source.release(reservation.getAmount());
                reservation.setStatus(ReservationStatus.CONSUMED);
                reservation.setClosedAt(Instant.now());
                reservationRepository.save(reservation);
            });
            source.debit(amount);
            balanceRepository.save(source);
        }
        if (destination != null) {
            destination.credit(amount);
            balanceRepository.save(destination);
        }

        BigDecimal sourceAfter = source == null ? null : source.getLedgerBalance();
        BigDecimal destinationAfter = destination == null ? null : destination.getLedgerBalance();
        ledger.sourceBalanceAfter(sourceAfter).destinationBalanceAfter(destinationAfter);

        return BalanceUpdatedEvent.builder()
                .transactionId(event.getTransactionId())
                .transactionType(type.name())
                .sourceAccountId(sourceId == null ? null : sourceId.toString())
                .destinationAccountId(destinationId == null ? null : destinationId.toString())
                .amount(amount)
                .currency(event.getCurrency())
                .sourceBalanceAfter(sourceAfter)
                .destinationBalanceAfter(destinationAfter)
                .correlationId(event.getCorrelationId())
                .build();
    }

    /** Locks the given balance rows in ascending id order (the deadlock-avoidance rule). */
    private Map<UUID, AccountBalance> lockInOrder(UUID first, UUID second) {
        TreeSet<UUID> ids = new TreeSet<>();
        if (first != null) {
            ids.add(first);
        }
        if (second != null) {
            ids.add(second);
        }
        Map<UUID, AccountBalance> locked = new HashMap<>();
        for (UUID id : ids) {
            locked.put(id, lockBalance(id));
        }
        return locked;
    }

    private AccountBalance lockBalance(UUID accountId) {
        return balanceRepository.findByIdForUpdate(accountId)
                .orElseThrow(() -> new AccountNotFoundException(accountId.toString()));
    }

    private static TransactionType parseType(String value) {
        try {
            return TransactionType.valueOf(value);
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new BankingException(ErrorCode.INVALID_TRANSACTION, "Unknown transaction type: " + value);
        }
    }

    private static UUID parseAccountId(String value, String role) {
        if (!StringUtils.hasText(value)) {
            throw new BankingException(ErrorCode.INVALID_TRANSACTION, "Missing " + role + " account id");
        }
        try {
            return UUID.fromString(value.trim());
        } catch (IllegalArgumentException e) {
            throw new AccountNotFoundException(value);
        }
    }
}

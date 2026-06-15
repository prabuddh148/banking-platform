package com.banking.transaction.service;

import com.banking.common.dto.PagedResponse;
import com.banking.common.exception.ResourceNotFoundException;
import com.banking.transaction.dto.request.DepositRequest;
import com.banking.transaction.dto.request.TransferRequest;
import com.banking.transaction.dto.response.TransactionResponse;
import com.banking.transaction.dto.response.TransactionStatusResponse;
import com.banking.transaction.entity.*;
import com.banking.transaction.mapper.TransactionMapper;
import com.banking.transaction.repository.OutboxEventRepository;
import com.banking.transaction.repository.TransactionRepository;
import com.banking.transaction.saga.TransactionSagaOrchestrator;
import com.banking.transaction.util.TransactionReferenceGenerator;
import com.banking.transaction.validation.TransactionValidator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
@Transactional
@Slf4j
@RequiredArgsConstructor
public class TransactionServiceImpl implements TransactionService {

    private final TransactionRepository transactionRepository;
    private final OutboxEventRepository outboxEventRepository;
    private final TransactionSagaOrchestrator sagaOrchestrator;
    private final TransactionMapper transactionMapper;
    private final TransactionReferenceGenerator referenceGenerator;
    private final TransactionValidator transactionValidator;

    @Override
    public TransactionResponse initiateTransfer(TransferRequest request) {
        log.info("Initiating transfer from accountId={} to accountId={}, amount={}",
                request.getSourceAccountId(), request.getTargetAccountId(), request.getAmount());

        transactionValidator.validateTransferRequest(request);

        String referenceNumber = referenceGenerator.generate();

        Transaction transaction = Transaction.builder()
                .referenceNumber(referenceNumber)
                .transactionType(TransactionType.TRANSFER)
                .sourceAccountId(request.getSourceAccountId())
                .targetAccountId(request.getTargetAccountId())
                .amount(request.getAmount())
                .currency(request.getCurrency().toUpperCase())
                .status(TransactionStatus.PENDING)
                .description(request.getDescription())
                .build();

        transaction = transactionRepository.save(transaction);

        createOutboxEvent(transaction, "transaction.initiated");

        sagaOrchestrator.initiateSaga(transaction);

        log.info("Transfer initiated successfully, transactionId={}, referenceNumber={}",
                transaction.getId(), transaction.getReferenceNumber());

        return transactionMapper.toResponse(transaction);
    }

    @Override
    public TransactionResponse initiateDeposit(DepositRequest request) {
        log.info("Initiating deposit to accountId={}, amount={}",
                request.getTargetAccountId(), request.getAmount());

        String referenceNumber = referenceGenerator.generate();

        Transaction transaction = Transaction.builder()
                .referenceNumber(referenceNumber)
                .transactionType(TransactionType.DEPOSIT)
                .targetAccountId(request.getTargetAccountId())
                .amount(request.getAmount())
                .currency(request.getCurrency().toUpperCase())
                .status(TransactionStatus.PENDING)
                .description(request.getDescription())
                .build();

        transaction = transactionRepository.save(transaction);

        createOutboxEvent(transaction, "transaction.initiated");

        sagaOrchestrator.initiateSaga(transaction);

        log.info("Deposit initiated successfully, transactionId={}, referenceNumber={}",
                transaction.getId(), transaction.getReferenceNumber());

        return transactionMapper.toResponse(transaction);
    }

    @Override
    @Transactional(readOnly = true)
    public TransactionResponse getTransaction(UUID id) {
        log.debug("Fetching transaction by id={}", id);
        Transaction transaction = transactionRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Transaction", id.toString()));
        return transactionMapper.toResponse(transaction);
    }

    @Override
    @Transactional(readOnly = true)
    public TransactionResponse getTransactionByReference(String referenceNumber) {
        log.debug("Fetching transaction by referenceNumber={}", referenceNumber);
        Transaction transaction = transactionRepository.findByReferenceNumber(referenceNumber)
                .orElseThrow(() -> new ResourceNotFoundException("Transaction", referenceNumber));
        return transactionMapper.toResponse(transaction);
    }

    @Override
    @Transactional(readOnly = true)
    public PagedResponse<TransactionResponse> getTransactionsByAccount(UUID accountId, int page, int size) {
        log.debug("Fetching transactions for accountId={}, page={}, size={}", accountId, page, size);
        Page<Transaction> transactionPage = transactionRepository
                .findBySourceAccountIdOrTargetAccountId(accountId, accountId, PageRequest.of(page, size));

        List<TransactionResponse> responses = transactionPage.getContent()
                .stream()
                .map(transactionMapper::toResponse)
                .toList();

        return PagedResponse.<TransactionResponse>builder()
                .content(responses)
                .page(page)
                .size(size)
                .totalElements(transactionPage.getTotalElements())
                .totalPages(transactionPage.getTotalPages())
                .last(transactionPage.isLast())
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public TransactionStatusResponse getStatus(UUID id) {
        log.debug("Fetching status for transactionId={}", id);
        Transaction transaction = transactionRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Transaction", id.toString()));

        return TransactionStatusResponse.builder()
                .transactionId(transaction.getId())
                .referenceNumber(transaction.getReferenceNumber())
                .status(transaction.getStatus())
                .updatedAt(transaction.getCompletedAt() != null ? transaction.getCompletedAt() : transaction.getInitiatedAt())
                .build();
    }

    private void createOutboxEvent(Transaction transaction, String topic) {
        OutboxEvent outboxEvent = OutboxEvent.builder()
                .id(UUID.randomUUID())
                .aggregateType("Transaction")
                .aggregateId(transaction.getId())
                .eventType("TRANSACTION_INITIATED")
                .payload(String.format("{\"transactionId\":\"%s\",\"referenceNumber\":\"%s\",\"type\":\"%s\"}",
                        transaction.getId(), transaction.getReferenceNumber(), transaction.getTransactionType()))
                .topic(topic)
                .partitionKey(transaction.getId().toString())
                .status(OutboxStatus.PENDING)
                .retryCount(0)
                .createdAt(Instant.now())
                .build();
        outboxEventRepository.save(outboxEvent);
    }
}

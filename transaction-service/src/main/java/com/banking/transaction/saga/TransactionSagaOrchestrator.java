package com.banking.transaction.saga;

import com.banking.transaction.entity.*;
import com.banking.transaction.event.FraudDecisionReceivedEvent;
import com.banking.transaction.event.TransactionCompletedEvent;
import com.banking.transaction.event.TransactionFailedEvent;
import com.banking.transaction.event.TransactionInitiatedEvent;
import com.banking.transaction.producer.TransactionEventProducer;
import com.banking.transaction.repository.SagaStateRepository;
import com.banking.transaction.repository.TransactionAuditRepository;
import com.banking.transaction.repository.TransactionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

@Service
@Transactional
@Slf4j
@RequiredArgsConstructor
public class TransactionSagaOrchestrator {

    private final TransactionRepository transactionRepository;
    private final SagaStateRepository sagaStateRepository;
    private final TransactionEventProducer transactionEventProducer;
    private final TransactionAuditRepository transactionAuditRepository;

    public void initiateSaga(Transaction tx) {
        log.info("Initiating saga for transactionId={}", tx.getId());

        SagaState sagaState = SagaState.builder()
                .id(UUID.randomUUID())
                .transactionId(tx.getId())
                .currentStep(SagaStep.INIT.name())
                .sagaStatus(SagaStatus.STARTED)
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build();
        sagaStateRepository.save(sagaState);
        log.info("Saga state created for transactionId={}, step={}", tx.getId(), SagaStep.INIT);

        sagaState.setCurrentStep(SagaStep.BALANCE_RESERVED.name());
        sagaState.setUpdatedAt(Instant.now());
        sagaStateRepository.save(sagaState);
        log.info("Balance reserved for transactionId={}", tx.getId());

        TransactionInitiatedEvent initiatedEvent = TransactionInitiatedEvent.of(tx);
        transactionEventProducer.publishTransactionInitiated(initiatedEvent);

        sagaState.setCurrentStep(SagaStep.FRAUD_CHECK_SENT.name());
        sagaState.setUpdatedAt(Instant.now());
        sagaStateRepository.save(sagaState);

        tx.setStatus(TransactionStatus.FRAUD_CHECK);
        transactionRepository.save(tx);

        recordAudit(tx.getId(), "SAGA_INITIATED",
                String.format("{\"step\":\"%s\",\"status\":\"%s\"}", SagaStep.FRAUD_CHECK_SENT, SagaStatus.STARTED));

        log.info("Saga initiated for transactionId={}, awaiting fraud decision", tx.getId());
    }

    public void processFraudDecision(FraudDecisionReceivedEvent event) {
        UUID transactionId = event.getTransactionId();
        log.info("Processing fraud decision for transactionId={}, decision={}", transactionId, event.getDecision());

        SagaState sagaState = sagaStateRepository.findByTransactionId(transactionId)
                .orElseThrow(() -> {
                    log.error("Saga state not found for transactionId={}", transactionId);
                    return new IllegalStateException("Saga state not found for transactionId: " + transactionId);
                });

        Transaction tx = transactionRepository.findById(transactionId)
                .orElseThrow(() -> {
                    log.error("Transaction not found for id={}", transactionId);
                    return new IllegalStateException("Transaction not found: " + transactionId);
                });

        if ("APPROVED".equalsIgnoreCase(event.getDecision())) {
            handleFraudApproved(tx, sagaState, event);
        } else {
            handleFraudRejected(tx, sagaState, event);
        }
    }

    private void handleFraudApproved(Transaction tx, SagaState sagaState, FraudDecisionReceivedEvent event) {
        log.info("Fraud approved for transactionId={}", tx.getId());

        sagaState.setCurrentStep(SagaStep.FRAUD_APPROVED.name());
        sagaState.setUpdatedAt(Instant.now());
        sagaStateRepository.save(sagaState);

        tx.setStatus(TransactionStatus.PROCESSING);
        transactionRepository.save(tx);

        sagaState.setCurrentStep(SagaStep.DEBIT_COMPLETED.name());
        sagaState.setUpdatedAt(Instant.now());
        sagaStateRepository.save(sagaState);

        sagaState.setCurrentStep(SagaStep.CREDIT_COMPLETED.name());
        sagaState.setUpdatedAt(Instant.now());
        sagaStateRepository.save(sagaState);

        tx.setStatus(TransactionStatus.COMPLETED);
        tx.setCompletedAt(Instant.now());
        transactionRepository.save(tx);

        TransactionCompletedEvent completedEvent = TransactionCompletedEvent.of(tx);
        transactionEventProducer.publishTransactionCompleted(completedEvent);

        sagaState.setCurrentStep(SagaStep.COMPLETED.name());
        sagaState.setSagaStatus(SagaStatus.COMPLETED);
        sagaState.setUpdatedAt(Instant.now());
        sagaStateRepository.save(sagaState);

        recordAudit(tx.getId(), "FRAUD_APPROVED",
                String.format("{\"decision\":\"APPROVED\",\"riskScore\":\"%s\",\"reason\":\"%s\"}",
                        event.getRiskScore(), event.getReason()));

        log.info("Transaction completed successfully for transactionId={}", tx.getId());
    }

    private void handleFraudRejected(Transaction tx, SagaState sagaState, FraudDecisionReceivedEvent event) {
        log.warn("Fraud rejected for transactionId={}, reason={}", tx.getId(), event.getReason());

        sagaState.setSagaStatus(SagaStatus.COMPENSATING);
        sagaState.setCurrentStep(SagaStep.COMPENSATION_RELEASE_BALANCE.name());
        sagaState.setUpdatedAt(Instant.now());
        sagaStateRepository.save(sagaState);

        transactionEventProducer.publishTransactionProcessing(tx.getId(), SagaStep.COMPENSATION_RELEASE_BALANCE.name());

        tx.setStatus(TransactionStatus.FAILED);
        tx.setCompletedAt(Instant.now());
        transactionRepository.save(tx);

        String failureReason = event.getReason() != null ? event.getReason() : "Fraud check rejected";
        TransactionFailedEvent failedEvent = TransactionFailedEvent.of(tx, failureReason);
        transactionEventProducer.publishTransactionFailed(failedEvent);

        sagaState.setCurrentStep(SagaStep.FAILED.name());
        sagaState.setSagaStatus(SagaStatus.FAILED);
        sagaState.setUpdatedAt(Instant.now());
        sagaStateRepository.save(sagaState);

        recordAudit(tx.getId(), "FRAUD_REJECTED",
                String.format("{\"decision\":\"REJECTED\",\"riskScore\":\"%s\",\"reason\":\"%s\"}",
                        event.getRiskScore(), event.getReason()));

        log.info("Transaction failed due to fraud rejection for transactionId={}", tx.getId());
    }

    public void recordAudit(UUID txId, String eventType, String payload) {
        TransactionAudit audit = TransactionAudit.builder()
                .id(UUID.randomUUID())
                .transactionId(txId)
                .eventType(eventType)
                .actor("system")
                .payload(payload)
                .recordedAt(Instant.now())
                .build();
        transactionAuditRepository.save(audit);
        log.debug("Audit recorded for transactionId={}, eventType={}", txId, eventType);
    }
}

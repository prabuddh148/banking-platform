package com.banking.transaction;

import com.banking.transaction.entity.*;
import com.banking.transaction.event.FraudDecisionReceivedEvent;
import com.banking.transaction.producer.TransactionEventProducer;
import com.banking.transaction.repository.SagaStateRepository;
import com.banking.transaction.repository.TransactionAuditRepository;
import com.banking.transaction.repository.TransactionRepository;
import com.banking.transaction.saga.TransactionSagaOrchestrator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class SagaOrchestratorTest {

    @Mock
    private TransactionRepository transactionRepository;

    @Mock
    private SagaStateRepository sagaStateRepository;

    @Mock
    private TransactionEventProducer transactionEventProducer;

    @Mock
    private TransactionAuditRepository transactionAuditRepository;

    @InjectMocks
    private TransactionSagaOrchestrator sagaOrchestrator;

    private Transaction testTransaction;

    @BeforeEach
    void setUp() {
        testTransaction = Transaction.builder()
                .id(UUID.randomUUID())
                .referenceNumber("TXN_SAGA_TEST")
                .transactionType(TransactionType.TRANSFER)
                .sourceAccountId(UUID.randomUUID())
                .targetAccountId(UUID.randomUUID())
                .amount(new BigDecimal("200.00"))
                .currency("USD")
                .status(TransactionStatus.PENDING)
                .build();
    }

    @Test
    void initiateSaga_shouldCreateSagaStateAndPublishEvent() {
        // Arrange
        when(sagaStateRepository.save(any(SagaState.class))).thenAnswer(inv -> inv.getArgument(0));
        when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));
        when(transactionAuditRepository.save(any(TransactionAudit.class))).thenAnswer(inv -> inv.getArgument(0));

        // Act
        sagaOrchestrator.initiateSaga(testTransaction);

        // Assert
        verify(sagaStateRepository, atLeastOnce()).save(any(SagaState.class));
        verify(transactionEventProducer).publishTransactionInitiated(any());
        assertEquals(TransactionStatus.FRAUD_CHECK, testTransaction.getStatus());
    }

    @Test
    void processFraudDecision_approved_shouldCompleteTransaction() {
        // Arrange
        SagaState sagaState = SagaState.builder()
                .id(UUID.randomUUID())
                .transactionId(testTransaction.getId())
                .currentStep("FRAUD_CHECK_SENT")
                .sagaStatus(SagaStatus.STARTED)
                .build();

        testTransaction.setStatus(TransactionStatus.FRAUD_CHECK);

        FraudDecisionReceivedEvent event = new FraudDecisionReceivedEvent(
                testTransaction.getId(), "APPROVED", new BigDecimal("0.1"), "Low risk");

        when(sagaStateRepository.findByTransactionId(testTransaction.getId())).thenReturn(Optional.of(sagaState));
        when(transactionRepository.findById(testTransaction.getId())).thenReturn(Optional.of(testTransaction));
        when(sagaStateRepository.save(any(SagaState.class))).thenAnswer(inv -> inv.getArgument(0));
        when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));
        when(transactionAuditRepository.save(any(TransactionAudit.class))).thenAnswer(inv -> inv.getArgument(0));

        // Act
        sagaOrchestrator.processFraudDecision(event);

        // Assert
        assertEquals(TransactionStatus.COMPLETED, testTransaction.getStatus());
        verify(transactionEventProducer).publishTransactionCompleted(any());
        assertEquals(SagaStatus.COMPLETED, sagaState.getSagaStatus());
    }

    @Test
    void processFraudDecision_rejected_shouldFailTransaction() {
        // Arrange
        SagaState sagaState = SagaState.builder()
                .id(UUID.randomUUID())
                .transactionId(testTransaction.getId())
                .currentStep("FRAUD_CHECK_SENT")
                .sagaStatus(SagaStatus.STARTED)
                .build();

        testTransaction.setStatus(TransactionStatus.FRAUD_CHECK);

        FraudDecisionReceivedEvent event = new FraudDecisionReceivedEvent(
                testTransaction.getId(), "REJECTED", new BigDecimal("0.9"), "High risk detected");

        when(sagaStateRepository.findByTransactionId(testTransaction.getId())).thenReturn(Optional.of(sagaState));
        when(transactionRepository.findById(testTransaction.getId())).thenReturn(Optional.of(testTransaction));
        when(sagaStateRepository.save(any(SagaState.class))).thenAnswer(inv -> inv.getArgument(0));
        when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));
        when(transactionAuditRepository.save(any(TransactionAudit.class))).thenAnswer(inv -> inv.getArgument(0));

        // Act
        sagaOrchestrator.processFraudDecision(event);

        // Assert
        assertEquals(TransactionStatus.FAILED, testTransaction.getStatus());
        verify(transactionEventProducer).publishTransactionFailed(any());
        assertEquals(SagaStatus.FAILED, sagaState.getSagaStatus());
    }
}

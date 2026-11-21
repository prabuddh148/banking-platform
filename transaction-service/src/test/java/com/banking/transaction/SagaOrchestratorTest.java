package com.banking.transaction;

import com.banking.common.event.BaseEvent;
import com.banking.common.event.EventType;
import com.banking.transaction.entity.SagaState;
import com.banking.transaction.entity.SagaStatus;
import com.banking.transaction.entity.Transaction;
import com.banking.transaction.entity.TransactionStatus;
import com.banking.transaction.entity.TransactionStatusHistory;
import com.banking.transaction.entity.TransactionType;
import com.banking.transaction.event.BalanceUpdateFailedEvent;
import com.banking.transaction.event.BalanceUpdateRequestedEvent;
import com.banking.transaction.event.BalanceUpdatedEvent;
import com.banking.transaction.event.FraudDecisionReceivedEvent;
import com.banking.transaction.event.FraudDecisionReceivedEvent.Decision;
import com.banking.transaction.event.TransactionCompletedEvent;
import com.banking.transaction.event.TransactionFailedEvent;
import com.banking.transaction.event.TransactionInitiatedEvent;
import com.banking.transaction.producer.TransactionEventProducer;
import com.banking.transaction.repository.ProcessedEventRepository;
import com.banking.transaction.repository.SagaStateRepository;
import com.banking.transaction.repository.TransactionAuditRepository;
import com.banking.transaction.repository.TransactionRepository;
import com.banking.transaction.repository.TransactionStatusHistoryRepository;
import com.banking.transaction.saga.SagaStep;
import com.banking.transaction.saga.TransactionSagaOrchestrator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Unit tests for the saga state machine. Repositories and the outbox producer are mocks,
 * so no database or Kafka is needed.
 */
@ExtendWith(MockitoExtension.class)
class SagaOrchestratorTest {

    @Mock
    private TransactionRepository transactionRepository;
    @Mock
    private SagaStateRepository sagaStateRepository;
    @Mock
    private TransactionStatusHistoryRepository historyRepository;
    @Mock
    private TransactionAuditRepository auditRepository;
    @Mock
    private ProcessedEventRepository processedEventRepository;
    @Mock
    private TransactionEventProducer eventProducer;

    private TransactionSagaOrchestrator orchestrator;

    private Transaction tx;
    private SagaState saga;

    @BeforeEach
    void setUp() {
        orchestrator = new TransactionSagaOrchestrator(transactionRepository, sagaStateRepository,
                historyRepository, auditRepository, processedEventRepository, eventProducer);
        ReflectionTestUtils.setField(orchestrator, "timeoutMinutes", 15L);

        tx = Transaction.builder()
                .id(UUID.randomUUID())
                .reference("TXN20261121ABCD1234")
                .transactionType(TransactionType.TRANSFER)
                .status(TransactionStatus.PENDING)
                .sourceAccountId("acc-1")
                .destinationAccountId("acc-2")
                .amount(new BigDecimal("2500.00"))
                .currency("INR")
                .initiatedBy("CUST-1001")
                .clientCountry("IN")
                .correlationId(UUID.randomUUID().toString())
                .build();
        saga = SagaState.builder()
                .id(UUID.randomUUID())
                .transactionId(tx.getId())
                .status(SagaStatus.AWAITING_FRAUD_CHECK)
                .currentStep(SagaStep.FRAUD_CHECK)
                .build();
    }

    // ------------------------------------------------------------------ start

    @Test
    @DisplayName("startSaga saves PENDING transaction, saga AWAITING_FRAUD_CHECK and queues TRANSACTION_INITIATED")
    void startSaga() {
        when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

        Transaction saved = orchestrator.startSaga(tx);

        assertThat(saved.getStatus()).isEqualTo(TransactionStatus.PENDING);
        ArgumentCaptor<SagaState> sagaCaptor = ArgumentCaptor.forClass(SagaState.class);
        verify(sagaStateRepository).save(sagaCaptor.capture());
        assertThat(sagaCaptor.getValue().getStatus()).isEqualTo(SagaStatus.AWAITING_FRAUD_CHECK);
        assertThat(sagaCaptor.getValue().getCurrentStep()).isEqualTo(SagaStep.FRAUD_CHECK);

        TransactionStatusHistory history = captureHistory(1).get(0);
        assertThat(history.getFromStatus()).isNull();
        assertThat(history.getToStatus()).isEqualTo(TransactionStatus.PENDING);

        TransactionInitiatedEvent event = (TransactionInitiatedEvent) capturePublished(1).get(0);
        assertThat(event.getEventType()).isEqualTo(EventType.TRANSACTION_INITIATED);
        assertThat(event.getAggregateId()).isEqualTo(tx.getId().toString());
        assertThat(event.getClientCountry()).isEqualTo("IN");
        assertThat(event.getAmount()).isEqualByComparingTo("2500.00");
    }

    // ------------------------------------------------------------------ happy path

    @Test
    @DisplayName("happy path: fraud APPROVE -> PROCESSING, then BALANCE_UPDATED -> COMPLETED")
    void happyPath() {
        givenTransactionAndSaga();

        orchestrator.handleFraudDecision(fraudEvent(Decision.APPROVE, 12));

        assertThat(tx.getStatus()).isEqualTo(TransactionStatus.PROCESSING);
        assertThat(tx.getRiskScore()).isEqualTo(12);
        assertThat(saga.getStatus()).isEqualTo(SagaStatus.AWAITING_BALANCE_UPDATE);
        assertThat(saga.getCurrentStep()).isEqualTo(SagaStep.BALANCE_UPDATE);

        orchestrator.handleBalanceUpdated(balanceUpdatedEvent());

        assertThat(tx.getStatus()).isEqualTo(TransactionStatus.COMPLETED);
        assertThat(tx.getCompletedAt()).isNotNull();
        assertThat(saga.getStatus()).isEqualTo(SagaStatus.COMPLETED);
        assertThat(saga.getCurrentStep()).isEqualTo(SagaStep.COMPLETION);
        assertThat(saga.getCompletedAt()).isNotNull();

        List<BaseEvent> published = capturePublished(2);
        assertThat(published.get(0)).isInstanceOf(BalanceUpdateRequestedEvent.class);
        assertThat(published.get(1)).isInstanceOf(TransactionCompletedEvent.class);
        assertThat(published.get(0).getCorrelationId()).isEqualTo(tx.getCorrelationId());

        List<TransactionStatusHistory> history = captureHistory(2);
        assertThat(history).extracting(TransactionStatusHistory::getToStatus)
                .containsExactly(TransactionStatus.PROCESSING, TransactionStatus.COMPLETED);
        assertThat(history.get(0).getFromStatus()).isEqualTo(TransactionStatus.PENDING);
    }

    // ------------------------------------------------------------------ fraud

    @Test
    @DisplayName("fraud BLOCK -> FAILED with FRAUD_BLOCKED and TRANSACTION_FAILED published")
    void fraudBlock() {
        givenTransactionAndSaga();

        orchestrator.handleFraudDecision(fraudEvent(Decision.BLOCK, 92));

        assertThat(tx.getStatus()).isEqualTo(TransactionStatus.FAILED);
        assertThat(tx.getFailureCode()).isEqualTo("FRAUD_BLOCKED");
        assertThat(tx.getRiskScore()).isEqualTo(92);
        assertThat(saga.getStatus()).isEqualTo(SagaStatus.FAILED);
        assertThat(saga.getFailureReason()).contains("Blocked by fraud check");

        TransactionFailedEvent event = (TransactionFailedEvent) capturePublished(1).get(0);
        assertThat(event.getFailureCode()).isEqualTo("FRAUD_BLOCKED");
        assertThat(captureHistory(1).get(0).getToStatus()).isEqualTo(TransactionStatus.FAILED);
    }

    @Test
    @DisplayName("fraud REVIEW -> UNDER_REVIEW (nothing published); admin approval then continues the saga")
    void fraudReviewThenApproved() {
        givenTransactionAndSaga();

        orchestrator.handleFraudDecision(fraudEvent(Decision.REVIEW, 70));

        assertThat(tx.getStatus()).isEqualTo(TransactionStatus.UNDER_REVIEW);
        assertThat(tx.getRiskScore()).isEqualTo(70);
        assertThat(saga.getStatus()).isEqualTo(SagaStatus.AWAITING_REVIEW);
        assertThat(saga.getCurrentStep()).isEqualTo(SagaStep.MANUAL_REVIEW);
        verify(eventProducer, never()).publish(any());

        FraudDecisionReceivedEvent approval = fraudEvent(Decision.APPROVE, 70);
        approval.setReviewedBy("ADMIN-1");
        orchestrator.handleFraudDecision(approval);

        assertThat(tx.getStatus()).isEqualTo(TransactionStatus.PROCESSING);
        assertThat(saga.getStatus()).isEqualTo(SagaStatus.AWAITING_BALANCE_UPDATE);
        assertThat(capturePublished(1).get(0)).isInstanceOf(BalanceUpdateRequestedEvent.class);
        assertThat(captureHistory(2).get(1).getReason()).contains("ADMIN-1");
    }

    @Test
    @DisplayName("fraud REVIEW then admin reject (BLOCK) -> FAILED")
    void fraudReviewThenRejected() {
        givenTransactionAndSaga();
        tx.setStatus(TransactionStatus.UNDER_REVIEW);
        saga.setStatus(SagaStatus.AWAITING_REVIEW);

        orchestrator.handleFraudDecision(fraudEvent(Decision.BLOCK, 70));

        assertThat(tx.getStatus()).isEqualTo(TransactionStatus.FAILED);
        assertThat(saga.getStatus()).isEqualTo(SagaStatus.FAILED);
        assertThat(capturePublished(1).get(0)).isInstanceOf(TransactionFailedEvent.class);
    }

    // ------------------------------------------------------------------ balance failure

    @Test
    @DisplayName("BALANCE_UPDATE_FAILED -> FAILED with account-service's error code")
    void balanceFailure() {
        givenTransactionAndSaga();
        tx.setStatus(TransactionStatus.PROCESSING);
        saga.setStatus(SagaStatus.AWAITING_BALANCE_UPDATE);
        saga.setCurrentStep(SagaStep.BALANCE_UPDATE);

        BalanceUpdateFailedEvent event = new BalanceUpdateFailedEvent();
        stamp(event, EventType.BALANCE_UPDATE_FAILED);
        event.setTransactionId(tx.getId().toString());
        event.setErrorCode("INSUFFICIENT_FUNDS");
        event.setReason("Available balance 100.00 is less than 2500.00");

        orchestrator.handleBalanceUpdateFailed(event);

        assertThat(tx.getStatus()).isEqualTo(TransactionStatus.FAILED);
        assertThat(tx.getFailureCode()).isEqualTo("INSUFFICIENT_FUNDS");
        assertThat(tx.getFailureReason()).contains("Available balance");
        assertThat(saga.getStatus()).isEqualTo(SagaStatus.FAILED);
        assertThat(saga.getCurrentStep()).isEqualTo(SagaStep.BALANCE_UPDATE);
        TransactionFailedEvent failed = (TransactionFailedEvent) capturePublished(1).get(0);
        assertThat(failed.getFailureCode()).isEqualTo("INSUFFICIENT_FUNDS");
    }

    // ------------------------------------------------------------------ timeout

    @Test
    @DisplayName("timeout job fails sagas stuck waiting for fraud / balance")
    void timeout() {
        when(sagaStateRepository.findByStatusInAndUpdatedAtBefore(anyCollection(), any(Instant.class)))
                .thenReturn(List.of(saga));
        when(transactionRepository.findById(tx.getId())).thenReturn(Optional.of(tx));

        orchestrator.timeOutStuckSagas();

        assertThat(tx.getStatus()).isEqualTo(TransactionStatus.FAILED);
        assertThat(tx.getFailureCode()).isEqualTo("TRANSACTION_FAILED");
        assertThat(tx.getFailureReason()).isEqualTo("Saga timed out");
        assertThat(saga.getStatus()).isEqualTo(SagaStatus.FAILED);
        assertThat(capturePublished(1).get(0)).isInstanceOf(TransactionFailedEvent.class);
    }

    @Test
    @DisplayName("timeout job skips transactions that already finished")
    void timeoutSkipsFinished() {
        tx.setStatus(TransactionStatus.COMPLETED);
        when(sagaStateRepository.findByStatusInAndUpdatedAtBefore(anyCollection(), any(Instant.class)))
                .thenReturn(List.of(saga));
        when(transactionRepository.findById(tx.getId())).thenReturn(Optional.of(tx));

        orchestrator.timeOutStuckSagas();

        assertThat(tx.getStatus()).isEqualTo(TransactionStatus.COMPLETED);
        verify(eventProducer, never()).publish(any());
    }

    // ------------------------------------------------------------------ idempotency & robustness

    @Test
    @DisplayName("duplicate event (same eventId) is skipped entirely")
    void duplicateEvent() {
        FraudDecisionReceivedEvent event = fraudEvent(Decision.APPROVE, 10);
        when(processedEventRepository.existsById(event.getEventId())).thenReturn(true);

        orchestrator.handleFraudDecision(event);

        verifyNoInteractions(transactionRepository, sagaStateRepository, historyRepository, eventProducer);
        verify(processedEventRepository, never()).save(any());
        assertThat(tx.getStatus()).isEqualTo(TransactionStatus.PENDING);
    }

    @Test
    @DisplayName("first delivery of an event is recorded in processed_events")
    void firstDeliveryIsRecorded() {
        givenTransactionAndSaga();

        orchestrator.handleFraudDecision(fraudEvent(Decision.APPROVE, 10));

        verify(processedEventRepository, times(1)).save(any());
    }

    @Test
    @DisplayName("event for an unknown transaction is ignored")
    void unknownTransaction() {
        when(transactionRepository.findById(any(UUID.class))).thenReturn(Optional.empty());

        BalanceUpdatedEvent event = new BalanceUpdatedEvent();
        stamp(event, EventType.BALANCE_UPDATED);
        event.setTransactionId(UUID.randomUUID().toString());

        orchestrator.handleBalanceUpdated(event);

        verify(eventProducer, never()).publish(any());
        verifyNoInteractions(historyRepository);
    }

    @Test
    @DisplayName("event that doesn't fit the current state is ignored (BALANCE_UPDATED while PENDING)")
    void unexpectedState() {
        givenTransactionAndSaga();

        orchestrator.handleBalanceUpdated(balanceUpdatedEvent());

        assertThat(tx.getStatus()).isEqualTo(TransactionStatus.PENDING);
        verify(eventProducer, never()).publish(any());
        verifyNoInteractions(historyRepository);
    }

    @Test
    @DisplayName("invalid transactionId in an event is ignored")
    void invalidTransactionId() {
        FraudDecisionReceivedEvent event = fraudEvent(Decision.APPROVE, 10);
        event.setTransactionId("not-a-uuid");

        orchestrator.handleFraudDecision(event);

        verifyNoInteractions(transactionRepository, eventProducer);
    }

    // ------------------------------------------------------------------ helpers

    private void givenTransactionAndSaga() {
        when(transactionRepository.findById(tx.getId())).thenReturn(Optional.of(tx));
        when(sagaStateRepository.findByTransactionId(tx.getId())).thenReturn(Optional.of(saga));
    }

    private FraudDecisionReceivedEvent fraudEvent(Decision decision, int score) {
        FraudDecisionReceivedEvent event = new FraudDecisionReceivedEvent();
        stamp(event, decision == Decision.APPROVE ? EventType.FRAUD_CLEARED : EventType.FRAUD_DETECTED);
        event.setTransactionId(tx.getId().toString());
        event.setDecision(decision);
        event.setRiskScore(score);
        event.setRiskLevel(score >= 80 ? "CRITICAL" : score >= 60 ? "HIGH" : "LOW");
        event.setReason("test");
        return event;
    }

    private BalanceUpdatedEvent balanceUpdatedEvent() {
        BalanceUpdatedEvent event = new BalanceUpdatedEvent();
        stamp(event, EventType.BALANCE_UPDATED);
        event.setTransactionId(tx.getId().toString());
        event.setAmount(tx.getAmount());
        event.setSourceBalanceAfter(new BigDecimal("7500.00"));
        event.setDestinationBalanceAfter(new BigDecimal("12500.00"));
        return event;
    }

    /** Fills the BaseEvent fields the way a real producer would. */
    private void stamp(BaseEvent event, EventType type) {
        event.setEventId(UUID.randomUUID().toString());
        event.setEventType(type);
        event.setAggregateId(tx.getId().toString());
        event.setOccurredAt(Instant.now());
    }

    private List<BaseEvent> capturePublished(int expected) {
        ArgumentCaptor<BaseEvent> captor = ArgumentCaptor.forClass(BaseEvent.class);
        verify(eventProducer, times(expected)).publish(captor.capture());
        return captor.getAllValues();
    }

    private List<TransactionStatusHistory> captureHistory(int expected) {
        ArgumentCaptor<TransactionStatusHistory> captor = ArgumentCaptor.forClass(TransactionStatusHistory.class);
        verify(historyRepository, times(expected)).save(captor.capture());
        return captor.getAllValues();
    }
}

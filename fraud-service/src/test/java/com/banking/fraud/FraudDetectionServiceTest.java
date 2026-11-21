package com.banking.fraud;

import com.banking.common.event.EventType;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.banking.fraud.dto.request.ReviewFraudAlertRequest;
import com.banking.fraud.dto.request.ReviewFraudAlertRequest.ReviewDecision;
import com.banking.fraud.dto.response.FraudAlertResponse;
import com.banking.fraud.entity.AlertStatus;
import com.banking.fraud.entity.Decision;
import com.banking.fraud.entity.FraudAlert;
import com.banking.fraud.entity.FraudDecision;
import com.banking.fraud.entity.RiskLevel;
import com.banking.fraud.event.FraudClearedEvent;
import com.banking.fraud.event.FraudDetectedEvent;
import com.banking.fraud.event.FraudResultEvent;
import com.banking.fraud.event.TransactionInitiatedEvent;
import com.banking.fraud.exception.FraudAlertNotFoundException;
import com.banking.fraud.mapper.FraudAlertMapper;
import com.banking.fraud.producer.FraudDecisionProducer;
import com.banking.fraud.repository.FraudAlertRepository;
import com.banking.fraud.repository.FraudDecisionRepository;
import com.banking.fraud.rules.RuleResult;
import com.banking.fraud.service.FraudDetectionServiceImpl;
import com.banking.fraud.service.FraudEvaluation;
import com.banking.fraud.service.RuleEngineService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mapstruct.factory.Mappers;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link FraudDetectionServiceImpl} with mocked repositories, rule engine and producer.
 */
@ExtendWith(MockitoExtension.class)
class FraudDetectionServiceTest {

    private static final String TX_ID = "TX-100";
    private static final String CORRELATION_ID = "corr-1";

    @Mock
    private RuleEngineService ruleEngine;
    @Mock
    private FraudDecisionRepository decisionRepository;
    @Mock
    private FraudAlertRepository alertRepository;
    @Mock
    private FraudDecisionProducer producer;

    private final FraudAlertMapper mapper = Mappers.getMapper(FraudAlertMapper.class);
    private FraudDetectionServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new FraudDetectionServiceImpl(ruleEngine, decisionRepository, alertRepository, producer, mapper);
    }

    private static TransactionInitiatedEvent initiatedEvent() {
        TransactionInitiatedEvent event = new TransactionInitiatedEvent();
        event.setEventId(UUID.randomUUID().toString());
        event.setEventType(EventType.TRANSACTION_INITIATED);
        event.setAggregateId(TX_ID);
        event.setCorrelationId(CORRELATION_ID);
        event.setOccurredAt(Instant.parse("2026-01-15T06:30:00Z"));
        event.setTransactionId(TX_ID);
        event.setTransactionType("TRANSFER");
        event.setSourceAccountId("ACC-1");
        event.setDestinationAccountId("ACC-2");
        event.setAmount(new BigDecimal("250000.00"));
        event.setCurrency("INR");
        event.setInitiatedBy("CUST-1001");
        event.setClientCountry("US");
        return event;
    }

    private static FraudEvaluation evaluation(int score, RiskLevel level, Decision decision, String... rules) {
        List<RuleResult> results = java.util.Arrays.stream(rules)
                .map(r -> RuleResult.triggered(r, 10, r + " fired")).toList();
        return new FraudEvaluation(score, level, decision, List.of(rules),
                rules.length == 0 ? "No fraud rules triggered" : "some reason", results);
    }

    private void saveReturnsArgument() {
        when(decisionRepository.save(any(FraudDecision.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    private FraudResultEvent capturePublished() {
        ArgumentCaptor<FraudResultEvent> captor = ArgumentCaptor.forClass(FraudResultEvent.class);
        verify(producer).publish(captor.capture());
        return captor.getValue();
    }

    @Test
    void lowRiskTransactionIsClearedWithoutAlert() {
        when(decisionRepository.existsByTransactionId(TX_ID)).thenReturn(false);
        when(ruleEngine.evaluate(any())).thenReturn(evaluation(0, RiskLevel.LOW, Decision.APPROVE));
        saveReturnsArgument();

        assertThat(service.processTransactionInitiated(initiatedEvent())).isTrue();

        ArgumentCaptor<FraudDecision> saved = ArgumentCaptor.forClass(FraudDecision.class);
        verify(decisionRepository).save(saved.capture());
        assertThat(saved.getValue().getAccountId()).isEqualTo("ACC-1");
        assertThat(saved.getValue().getDecision()).isEqualTo(Decision.APPROVE);
        assertThat(saved.getValue().getInitiatedBy()).isEqualTo("CUST-1001");
        verify(alertRepository, never()).save(any());

        FraudResultEvent event = capturePublished();
        assertThat(event).isInstanceOf(FraudClearedEvent.class);
        assertThat(event.getEventType()).isEqualTo(EventType.FRAUD_CLEARED);
        assertThat(event.getAggregateId()).isEqualTo(TX_ID);
        assertThat(event.getCorrelationId()).isEqualTo(CORRELATION_ID);
        assertThat(event.getDecision()).isEqualTo(Decision.APPROVE);
        assertThat(event.getAlertId()).isNull();
        assertThat(event.getReviewedBy()).isNull();
    }

    @Test
    void highRiskTransactionCreatesOpenAlertAndRequestsReview() {
        UUID alertId = UUID.randomUUID();
        when(decisionRepository.existsByTransactionId(TX_ID)).thenReturn(false);
        when(ruleEngine.evaluate(any()))
                .thenReturn(evaluation(65, RiskLevel.HIGH, Decision.REVIEW, "AMOUNT_THRESHOLD", "GEOGRAPHIC"));
        saveReturnsArgument();
        when(alertRepository.save(any(FraudAlert.class))).thenAnswer(inv -> {
            FraudAlert a = inv.getArgument(0);
            a.setId(alertId);
            return a;
        });

        service.processTransactionInitiated(initiatedEvent());

        ArgumentCaptor<FraudAlert> alert = ArgumentCaptor.forClass(FraudAlert.class);
        verify(alertRepository).save(alert.capture());
        assertThat(alert.getValue().getStatus()).isEqualTo(AlertStatus.OPEN);
        assertThat(alert.getValue().getRiskScore()).isEqualTo(65);
        assertThat(alert.getValue().getTriggeredRules()).containsExactly("AMOUNT_THRESHOLD", "GEOGRAPHIC");

        FraudResultEvent event = capturePublished();
        assertThat(event).isInstanceOf(FraudDetectedEvent.class);
        assertThat(event.getEventType()).isEqualTo(EventType.FRAUD_DETECTED);
        assertThat(event.getDecision()).isEqualTo(Decision.REVIEW);
        assertThat(event.getRiskLevel()).isEqualTo(RiskLevel.HIGH);
        assertThat(event.getAlertId()).isEqualTo(alertId.toString());
    }

    @Test
    void criticalRiskTransactionIsBlocked() {
        when(decisionRepository.existsByTransactionId(TX_ID)).thenReturn(false);
        when(ruleEngine.evaluate(any())).thenReturn(evaluation(100, RiskLevel.CRITICAL, Decision.BLOCK, "AMOUNT_THRESHOLD"));
        saveReturnsArgument();
        when(alertRepository.save(any(FraudAlert.class))).thenAnswer(inv -> inv.getArgument(0));

        service.processTransactionInitiated(initiatedEvent());

        ArgumentCaptor<FraudAlert> alert = ArgumentCaptor.forClass(FraudAlert.class);
        verify(alertRepository).save(alert.capture());
        // Blocked transactions fail immediately, so their alert is closed right away and cannot be reviewed.
        assertThat(alert.getValue().getStatus()).isEqualTo(AlertStatus.REJECTED);

        FraudResultEvent event = capturePublished();
        assertThat(event).isInstanceOf(FraudDetectedEvent.class);
        assertThat(event.getDecision()).isEqualTo(Decision.BLOCK);
        assertThat(event.getRiskScore()).isEqualTo(100);
    }

    @Test
    void duplicateEventIsSkipped() {
        when(decisionRepository.existsByTransactionId(TX_ID)).thenReturn(true);

        assertThat(service.processTransactionInitiated(initiatedEvent())).isFalse();

        verifyNoInteractions(ruleEngine, alertRepository, producer);
        verify(decisionRepository, never()).save(any());
    }

    private FraudAlert openAlert(UUID id) {
        return FraudAlert.builder()
                .id(id).transactionId(TX_ID).accountId("ACC-1")
                .amount(new BigDecimal("250000.00")).currency("INR")
                .riskScore(65).riskLevel(RiskLevel.HIGH)
                .triggeredRules(new java.util.ArrayList<>(List.of("AMOUNT_THRESHOLD", "GEOGRAPHIC")))
                .status(AlertStatus.OPEN).reason("some reason").createdAt(Instant.now())
                .build();
    }

    private FraudDecision reviewDecision() {
        return FraudDecision.builder()
                .transactionId(TX_ID).accountId("ACC-1").amount(new BigDecimal("250000.00"))
                .riskScore(65).riskLevel(RiskLevel.HIGH).decision(Decision.REVIEW)
                .triggeredRules(new java.util.ArrayList<>(List.of("AMOUNT_THRESHOLD", "GEOGRAPHIC")))
                .reason("some reason").correlationId(CORRELATION_ID).initiatedBy("CUST-1001")
                .evaluatedAt(Instant.now())
                .build();
    }

    @Test
    void approvingAlertPublishesFraudCleared() {
        UUID alertId = UUID.randomUUID();
        FraudDecision decision = reviewDecision();
        when(alertRepository.findById(alertId)).thenReturn(Optional.of(openAlert(alertId)));
        when(decisionRepository.findByTransactionId(TX_ID)).thenReturn(Optional.of(decision));
        when(alertRepository.saveAndFlush(any(FraudAlert.class))).thenAnswer(inv -> inv.getArgument(0));

        FraudAlertResponse response = service.reviewAlert(alertId,
                new ReviewFraudAlertRequest(ReviewDecision.APPROVE, "Customer confirmed by phone"), "ADMIN-1");

        assertThat(response.status()).isEqualTo(AlertStatus.APPROVED);
        assertThat(response.reviewedBy()).isEqualTo("ADMIN-1");
        assertThat(response.reviewNotes()).isEqualTo("Customer confirmed by phone");
        assertThat(response.reviewedAt()).isNotNull();
        assertThat(decision.getDecision()).isEqualTo(Decision.APPROVE);
        verify(decisionRepository).save(decision);

        FraudResultEvent event = capturePublished();
        assertThat(event).isInstanceOf(FraudClearedEvent.class);
        assertThat(event.getDecision()).isEqualTo(Decision.APPROVE);
        assertThat(event.getReviewedBy()).isEqualTo("ADMIN-1");
        assertThat(event.getAlertId()).isEqualTo(alertId.toString());
        assertThat(event.getCorrelationId()).isEqualTo(CORRELATION_ID);
    }

    @Test
    void rejectingAlertPublishesFraudDetectedBlock() {
        UUID alertId = UUID.randomUUID();
        FraudDecision decision = reviewDecision();
        when(alertRepository.findById(alertId)).thenReturn(Optional.of(openAlert(alertId)));
        when(decisionRepository.findByTransactionId(TX_ID)).thenReturn(Optional.of(decision));
        when(alertRepository.saveAndFlush(any(FraudAlert.class))).thenAnswer(inv -> inv.getArgument(0));

        FraudAlertResponse response = service.reviewAlert(alertId,
                new ReviewFraudAlertRequest(ReviewDecision.REJECT, null), "ADMIN-1");

        assertThat(response.status()).isEqualTo(AlertStatus.REJECTED);
        assertThat(decision.getDecision()).isEqualTo(Decision.BLOCK);

        FraudResultEvent event = capturePublished();
        assertThat(event).isInstanceOf(FraudDetectedEvent.class);
        assertThat(event.getEventType()).isEqualTo(EventType.FRAUD_DETECTED);
        assertThat(event.getDecision()).isEqualTo(Decision.BLOCK);
        assertThat(event.getReviewedBy()).isEqualTo("ADMIN-1");
    }

    @Test
    void alreadyReviewedAlertCannotBeReviewedAgain() {
        UUID alertId = UUID.randomUUID();
        FraudAlert alert = openAlert(alertId);
        alert.setStatus(AlertStatus.APPROVED);
        when(alertRepository.findById(alertId)).thenReturn(Optional.of(alert));

        assertThatThrownBy(() -> service.reviewAlert(alertId,
                new ReviewFraudAlertRequest(ReviewDecision.REJECT, null), "ADMIN-1"))
                .isInstanceOf(BankingException.class)
                .extracting(ex -> ((BankingException) ex).getErrorCode())
                .isEqualTo(ErrorCode.CONFLICT);
        verifyNoInteractions(producer);
    }

    @Test
    void reviewingUnknownAlertFails() {
        UUID alertId = UUID.randomUUID();
        when(alertRepository.findById(alertId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.reviewAlert(alertId,
                new ReviewFraudAlertRequest(ReviewDecision.APPROVE, null), "ADMIN-1"))
                .isInstanceOf(FraudAlertNotFoundException.class);
        verifyNoInteractions(producer);
    }
}

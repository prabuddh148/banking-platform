package com.banking.fraud.service;

import com.banking.common.dto.PagedResponse;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.banking.common.security.CurrentUser;
import com.banking.fraud.dto.request.FraudCheckRequest;
import com.banking.fraud.dto.request.ReviewFraudAlertRequest;
import com.banking.fraud.dto.response.FraudAlertResponse;
import com.banking.fraud.dto.response.FraudDecisionResponse;
import com.banking.fraud.dto.response.FraudStatsResponse;
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
import com.banking.fraud.exception.FraudDecisionNotFoundException;
import com.banking.fraud.mapper.FraudAlertMapper;
import com.banking.fraud.producer.FraudDecisionProducer;
import com.banking.fraud.repository.FraudAlertRepository;
import com.banking.fraud.repository.FraudDecisionRepository;
import com.banking.fraud.rules.TransactionContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Default {@link FraudDetectionService}.
 * <p>
 * Flow for a new transaction: run rules -> save FraudDecision -> save FraudAlert if REVIEW/BLOCK ->
 * publish the event. The Kafka send waits for the broker, inside the DB transaction: if publishing
 * fails, the DB changes roll back and the Kafka listener retries the whole message.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FraudDetectionServiceImpl implements FraudDetectionService {

    /** reviewedBy value for alerts closed automatically (BLOCK decisions). */
    static final String SYSTEM_REVIEWER = "SYSTEM";

    private final RuleEngineService ruleEngine;
    private final FraudDecisionRepository decisionRepository;
    private final FraudAlertRepository alertRepository;
    private final FraudDecisionProducer producer;
    private final FraudAlertMapper mapper;

    @Override
    @Transactional
    public boolean processTransactionInitiated(TransactionInitiatedEvent event) {
        String transactionId = event.getTransactionId() != null ? event.getTransactionId() : event.getAggregateId();
        if (transactionId == null) {
            throw new IllegalArgumentException("TRANSACTION_INITIATED event without transactionId: " + event.getEventId());
        }
        if (decisionRepository.existsByTransactionId(transactionId)) {
            log.info("Transaction {} was already checked, skipping duplicate event {}", transactionId, event.getEventId());
            return false;
        }

        TransactionContext context = new TransactionContext(transactionId, event.riskAccountId(), event.getAmount(),
                event.getCurrency(), event.getTransactionType(), event.getClientCountry(), event.getOccurredAt());
        FraudEvaluation evaluation = ruleEngine.evaluate(context);

        FraudDecision decision = decisionRepository.save(FraudDecision.builder()
                .transactionId(transactionId)
                .accountId(context.accountId())
                .transactionType(event.getTransactionType())
                .amount(event.getAmount())
                .currency(event.getCurrency())
                .initiatedBy(event.getInitiatedBy())
                .clientCountry(event.getClientCountry())
                .riskScore(evaluation.riskScore())
                .riskLevel(evaluation.riskLevel())
                .decision(evaluation.decision())
                .triggeredRules(new ArrayList<>(evaluation.triggeredRules()))
                .reason(evaluation.reason())
                .correlationId(event.getCorrelationId())
                .evaluatedAt(Instant.now())
                .build());

        FraudAlert alert = null;
        if (evaluation.decision() != Decision.APPROVE) {
            alert = alertRepository.save(newAlert(decision));
        }

        log.info("Transaction {}: score={} level={} decision={} rules={}", transactionId,
                evaluation.riskScore(), evaluation.riskLevel(), evaluation.decision(), evaluation.triggeredRules());

        producer.publish(buildEvent(decision, evaluation.decision(), alert, null));
        return true;
    }

    @Override
    @Transactional(readOnly = true)
    public FraudDecisionResponse checkTransaction(FraudCheckRequest request) {
        TransactionContext context = new TransactionContext(request.transactionId(), request.accountId(),
                request.amount(), request.currency(), request.transactionType(), request.clientCountry(), Instant.now());
        FraudEvaluation evaluation = ruleEngine.evaluate(context);
        return new FraudDecisionResponse(request.transactionId(), evaluation.riskScore(), evaluation.riskLevel(),
                evaluation.decision(), evaluation.triggeredRules(), evaluation.reason(), Instant.now());
    }

    @Override
    @Transactional(readOnly = true)
    public PagedResponse<FraudAlertResponse> getAlerts(AlertStatus status, RiskLevel riskLevel, Pageable pageable) {
        return PagedResponse.from(alertRepository.search(status, riskLevel, pageable), mapper::toResponse);
    }

    @Override
    @Transactional(readOnly = true)
    public FraudAlertResponse getAlert(UUID alertId) {
        return mapper.toResponse(findAlert(alertId));
    }

    @Override
    @Transactional
    public FraudAlertResponse reviewAlert(UUID alertId, ReviewFraudAlertRequest request, String reviewerId) {
        FraudAlert alert = findAlert(alertId);
        if (alert.getStatus() != AlertStatus.OPEN) {
            throw new BankingException(ErrorCode.CONFLICT,
                    "Alert " + alertId + " is already " + alert.getStatus() + " and cannot be reviewed again");
        }
        FraudDecision decision = decisionRepository.findByTransactionId(alert.getTransactionId())
                .orElseThrow(() -> new FraudDecisionNotFoundException(alert.getTransactionId()));

        boolean approved = request.decision() == ReviewFraudAlertRequest.ReviewDecision.APPROVE;
        Decision finalDecision = approved ? Decision.APPROVE : Decision.BLOCK;
        String verdict = (approved ? "Approved" : "Rejected") + " by " + reviewerId;

        alert.setStatus(approved ? AlertStatus.APPROVED : AlertStatus.REJECTED);
        alert.setReviewedBy(reviewerId);
        alert.setReviewNotes(request.notes());
        alert.setReviewedAt(Instant.now());

        decision.setDecision(finalDecision);
        decision.setReviewedBy(reviewerId);
        decision.setReason(decision.getReason() + " | " + verdict
                + (request.notes() != null && !request.notes().isBlank() ? ": " + request.notes() : ""));

        // saveAndFlush so an optimistic-lock conflict is detected BEFORE we publish the event
        FraudAlert saved = alertRepository.saveAndFlush(alert);
        decisionRepository.save(decision);

        log.info("Alert {} for transaction {} {}", alertId, alert.getTransactionId(), verdict);
        producer.publish(buildEvent(decision, finalDecision, saved, reviewerId));
        return mapper.toResponse(saved);
    }

    @Override
    @Transactional(readOnly = true)
    public FraudDecisionResponse getDecisionByTransactionId(String transactionId) {
        FraudDecision decision = decisionRepository.findByTransactionId(transactionId)
                .orElseThrow(() -> new FraudDecisionNotFoundException(transactionId));
        CurrentUser.requireOwnerOrAdmin(decision.getInitiatedBy());
        return mapper.toDecisionResponse(decision);
    }

    @Override
    @Transactional(readOnly = true)
    public FraudStatsResponse getStats() {
        Map<String, Long> alertsByStatus = new LinkedHashMap<>();
        for (AlertStatus status : AlertStatus.values()) {
            alertsByStatus.put(status.name(), alertRepository.countByStatus(status));
        }
        Map<String, Long> decisionsByLevel = new LinkedHashMap<>();
        for (RiskLevel level : RiskLevel.values()) {
            decisionsByLevel.put(level.name(), decisionRepository.countByRiskLevel(level));
        }
        return new FraudStatsResponse(alertRepository.count(), alertsByStatus,
                decisionRepository.count(), decisionsByLevel);
    }

    private FraudAlert findAlert(UUID alertId) {
        return alertRepository.findById(alertId).orElseThrow(() -> new FraudAlertNotFoundException(alertId));
    }

    /**
     * REVIEW -> OPEN alert waiting for an admin. BLOCK -> the transaction already fails, so the alert
     * is recorded for the record but closed right away (REJECTED by SYSTEM); it cannot be "approved" later.
     */
    private FraudAlert newAlert(FraudDecision decision) {
        boolean blocked = decision.getDecision() == Decision.BLOCK;
        Instant now = Instant.now();
        return FraudAlert.builder()
                .transactionId(decision.getTransactionId())
                .accountId(decision.getAccountId())
                .amount(decision.getAmount())
                .currency(decision.getCurrency())
                .riskScore(decision.getRiskScore())
                .riskLevel(decision.getRiskLevel())
                .triggeredRules(new ArrayList<>(decision.getTriggeredRules()))
                .reason(decision.getReason())
                .status(blocked ? AlertStatus.REJECTED : AlertStatus.OPEN)
                .reviewedBy(blocked ? SYSTEM_REVIEWER : null)
                .reviewedAt(blocked ? now : null)
                .createdAt(now)
                .build();
    }

    private FraudResultEvent buildEvent(FraudDecision decision, Decision outcome, FraudAlert alert, String reviewedBy) {
        FraudResultEvent event = outcome == Decision.APPROVE
                ? new FraudClearedEvent(decision.getTransactionId(), decision.getCorrelationId())
                : new FraudDetectedEvent(decision.getTransactionId(), decision.getCorrelationId(), outcome);
        event.setRiskScore(decision.getRiskScore());
        event.setRiskLevel(decision.getRiskLevel());
        event.setTriggeredRules(new ArrayList<>(decision.getTriggeredRules()));
        event.setReason(decision.getReason());
        event.setAlertId(alert != null && alert.getId() != null ? alert.getId().toString() : null);
        event.setReviewedBy(reviewedBy);
        return event;
    }
}

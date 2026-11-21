package com.banking.fraud.service;

import com.banking.common.dto.PagedResponse;
import com.banking.fraud.dto.request.FraudCheckRequest;
import com.banking.fraud.dto.request.ReviewFraudAlertRequest;
import com.banking.fraud.dto.response.FraudAlertResponse;
import com.banking.fraud.dto.response.FraudDecisionResponse;
import com.banking.fraud.dto.response.FraudStatsResponse;
import com.banking.fraud.entity.AlertStatus;
import com.banking.fraud.entity.RiskLevel;
import com.banking.fraud.event.TransactionInitiatedEvent;
import org.springframework.data.domain.Pageable;

import java.util.UUID;

/**
 * Business operations of the fraud-service.
 */
public interface FraudDetectionService {

    /**
     * Checks a newly initiated transaction, stores the decision (and an alert when suspicious)
     * and publishes FRAUD_CLEARED or FRAUD_DETECTED. Does nothing if the transaction was already checked.
     *
     * @return true if the transaction was processed, false if it was a duplicate
     */
    boolean processTransactionInitiated(TransactionInitiatedEvent event);

    /** Runs the rules without storing or publishing anything. */
    FraudDecisionResponse checkTransaction(FraudCheckRequest request);

    PagedResponse<FraudAlertResponse> getAlerts(AlertStatus status, RiskLevel riskLevel, Pageable pageable);

    FraudAlertResponse getAlert(UUID alertId);

    /**
     * Admin verdict on an OPEN alert: APPROVE publishes FRAUD_CLEARED, REJECT publishes FRAUD_DETECTED (BLOCK).
     *
     * @param reviewerId userId of the admin
     */
    FraudAlertResponse reviewAlert(UUID alertId, ReviewFraudAlertRequest request, String reviewerId);

    /** Stored decision for a transaction; customers may only read decisions of their own transactions. */
    FraudDecisionResponse getDecisionByTransactionId(String transactionId);

    FraudStatsResponse getStats();
}

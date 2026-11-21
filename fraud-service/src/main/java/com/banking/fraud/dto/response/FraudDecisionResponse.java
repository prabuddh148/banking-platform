package com.banking.fraud.dto.response;

import com.banking.fraud.entity.Decision;
import com.banking.fraud.entity.RiskLevel;

import java.time.Instant;
import java.util.List;

/**
 * The fraud verdict for a transaction (stored, or computed by a dry run).
 */
public record FraudDecisionResponse(
        String transactionId,
        int riskScore,
        RiskLevel riskLevel,
        Decision decision,
        List<String> triggeredRules,
        String reason,
        Instant evaluatedAt) {
}

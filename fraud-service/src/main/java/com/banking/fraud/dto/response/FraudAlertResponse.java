package com.banking.fraud.dto.response;

import com.banking.fraud.entity.AlertStatus;
import com.banking.fraud.entity.RiskLevel;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A fraud alert as returned by the API.
 */
public record FraudAlertResponse(
        UUID id,
        String transactionId,
        String accountId,
        BigDecimal amount,
        String currency,
        int riskScore,
        RiskLevel riskLevel,
        List<String> triggeredRules,
        AlertStatus status,
        String reason,
        String reviewedBy,
        String reviewNotes,
        Instant createdAt,
        Instant reviewedAt) {
}

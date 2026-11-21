package com.banking.fraud.dto.response;

import java.util.Map;

/**
 * Dashboard numbers for {@code GET /api/v1/fraud/stats}.
 *
 * @param totalAlerts          number of alerts ever raised
 * @param alertsByStatus       OPEN / APPROVED / REJECTED -> count
 * @param totalDecisions       number of transactions checked
 * @param decisionsByRiskLevel LOW / MEDIUM / HIGH / CRITICAL -> count
 */
public record FraudStatsResponse(
        long totalAlerts,
        Map<String, Long> alertsByStatus,
        long totalDecisions,
        Map<String, Long> decisionsByRiskLevel) {
}

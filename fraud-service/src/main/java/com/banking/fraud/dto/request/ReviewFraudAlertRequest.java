package com.banking.fraud.dto.request;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Body of {@code POST /api/v1/fraud/alerts/{id}/review}: the admin's verdict on an alert.
 */
public record ReviewFraudAlertRequest(
        @NotNull ReviewDecision decision,
        @Size(max = 2000) String notes) {

    /** APPROVE lets the transaction continue, REJECT blocks it. */
    public enum ReviewDecision {
        APPROVE,
        REJECT
    }
}

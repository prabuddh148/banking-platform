package com.banking.fraud.dto.request;

import com.banking.common.validation.ValidCurrency;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

/**
 * Body of {@code POST /api/v1/fraud/check}: a "what would the rules say?" dry run. Nothing is stored.
 */
public record FraudCheckRequest(
        String transactionId,
        String accountId,
        @NotNull @Positive BigDecimal amount,
        @ValidCurrency String currency,
        String transactionType,
        @Size(max = 8) String clientCountry) {
}

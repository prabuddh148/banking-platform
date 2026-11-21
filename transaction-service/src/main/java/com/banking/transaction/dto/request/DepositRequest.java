package com.banking.transaction.dto.request;

import com.banking.common.validation.ValidCurrency;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

/**
 * Body of {@code POST /deposit} and {@code POST /withdraw}: one account and an amount.
 *
 * @param accountId   account to credit (deposit) or debit (withdrawal)
 * @param amount      greater than 0, at most 10,000,000, max 2 decimals
 * @param currency    optional, defaults to INR
 * @param description optional free text
 */
public record DepositRequest(
        @NotBlank(message = "accountId is required")
        @Size(max = 64)
        String accountId,

        @NotNull(message = "amount is required")
        @DecimalMin(value = "0.00", inclusive = false, message = "amount must be greater than 0")
        @DecimalMax(value = "10000000.00", message = "amount must not exceed 10,000,000")
        @Digits(integer = 17, fraction = 2, message = "amount can have at most 2 decimal places")
        BigDecimal amount,

        @ValidCurrency
        String currency,

        @Size(max = 255)
        String description
) {
}

package com.banking.transaction.dto.request;

import com.banking.common.validation.ValidCurrency;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

/**
 * Body of {@code POST /transfer}: move money from one account to another.
 *
 * @param currency optional, defaults to INR
 */
public record TransferRequest(
        @NotBlank(message = "sourceAccountId is required")
        @Size(max = 64)
        String sourceAccountId,

        @NotBlank(message = "destinationAccountId is required")
        @Size(max = 64)
        String destinationAccountId,

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

    /** Bean Validation calls this "isXxx" method; false means source and destination are the same. */
    @AssertTrue(message = "destinationAccountId must be different from sourceAccountId")
    public boolean isDifferentAccounts() {
        return sourceAccountId == null || destinationAccountId == null
                || !sourceAccountId.equals(destinationAccountId);
    }
}

package com.banking.account.dto.request;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * Body of POST /api/v1/accounts/{id}/balance/reserve and /release.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReserveBalanceRequest {

    @NotNull(message = "amount is required")
    @DecimalMin(value = "0.01", message = "amount must be greater than 0")
    @Digits(integer = 17, fraction = 2)
    private BigDecimal amount;

    @NotBlank(message = "transactionId is required")
    @Size(max = 64)
    private String transactionId;
}

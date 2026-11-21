package com.banking.account.dto.request;

import com.banking.account.entity.AccountType;
import com.banking.common.validation.ValidCurrency;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * Body of POST /api/v1/accounts.
 * currency defaults to INR and initialDeposit to 0 when not sent.
 * customerId is only used when an admin opens an account for someone else.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CreateAccountRequest {

    @NotBlank(message = "customerName is required")
    @Size(max = 150)
    private String customerName;

    @NotBlank(message = "customerEmail is required")
    @Email(message = "customerEmail must be a valid email")
    private String customerEmail;

    @Pattern(regexp = "^[+]?[0-9]{7,15}$", message = "customerPhone must be 7-15 digits, optionally starting with +")
    private String customerPhone;

    @NotNull(message = "accountType is required (SAVINGS, CURRENT or FIXED_DEPOSIT)")
    private AccountType accountType;

    @ValidCurrency
    private String currency;

    @DecimalMin(value = "0.00", message = "initialDeposit cannot be negative")
    @Digits(integer = 17, fraction = 2)
    private BigDecimal initialDeposit;

    @Size(max = 64)
    private String customerId;
}

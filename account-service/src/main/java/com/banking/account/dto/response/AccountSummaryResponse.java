package com.banking.account.dto.response;

import com.banking.account.entity.AccountStatus;
import com.banking.account.entity.AccountType;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Short view of an account used in list results.
 */
public record AccountSummaryResponse(
        UUID id,
        String accountNumber,
        AccountType accountType,
        AccountStatus status,
        String currency,
        BigDecimal balance,
        String customerName) {
}

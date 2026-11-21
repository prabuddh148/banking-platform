package com.banking.account.dto.response;

import com.banking.account.entity.AccountStatus;
import com.banking.account.entity.AccountType;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Full view of one account (GET /{id}, GET /number/{accountNumber}, create, update...).
 */
public record AccountResponse(
        UUID id,
        String accountNumber,
        String customerId,
        String customerName,
        String customerEmail,
        String customerPhone,
        AccountType accountType,
        AccountStatus status,
        String currency,
        BigDecimal balance,
        BigDecimal availableBalance,
        Instant createdAt,
        Instant updatedAt) {
}

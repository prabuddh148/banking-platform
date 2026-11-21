package com.banking.account.dto.response;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Balance details of an account. availableBalance = ledgerBalance - reservedAmount.
 */
public record AccountBalanceResponse(
        UUID accountId,
        String accountNumber,
        BigDecimal ledgerBalance,
        BigDecimal availableBalance,
        BigDecimal reservedAmount,
        String currency,
        Instant lastUpdated) {
}

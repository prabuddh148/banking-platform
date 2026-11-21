package com.banking.transaction.dto.response;

import com.banking.transaction.entity.TransactionStatus;
import com.banking.transaction.entity.TransactionType;
import lombok.Builder;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** What the API returns for a transaction. */
@Builder
public record TransactionResponse(
        UUID id,
        String reference,
        TransactionType transactionType,
        TransactionStatus status,
        String sourceAccountId,
        String destinationAccountId,
        BigDecimal amount,
        String currency,
        String description,
        String initiatedBy,
        String failureReason,
        String failureCode,
        Integer riskScore,
        Instant createdAt,
        Instant updatedAt,
        Instant completedAt
) {
}

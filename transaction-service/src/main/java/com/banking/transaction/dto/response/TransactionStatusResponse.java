package com.banking.transaction.dto.response;

import com.banking.transaction.entity.TransactionStatus;
import lombok.Builder;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Current status of a transaction plus every status change so far (oldest first). */
@Builder
public record TransactionStatusResponse(
        UUID transactionId,
        String reference,
        TransactionStatus status,
        String failureReason,
        List<StatusChange> history
) {

    /** One entry of the status history. {@code fromStatus} is null for the creation entry. */
    @Builder
    public record StatusChange(
            TransactionStatus fromStatus,
            TransactionStatus toStatus,
            String reason,
            Instant changedAt
    ) {
    }
}

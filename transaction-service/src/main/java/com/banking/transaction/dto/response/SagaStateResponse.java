package com.banking.transaction.dto.response;

import com.banking.transaction.entity.SagaStatus;
import com.banking.transaction.saga.SagaStep;
import lombok.Builder;

import java.time.Instant;
import java.util.UUID;

/** Admin view of the saga driving a transaction. */
@Builder
public record SagaStateResponse(
        UUID sagaId,
        UUID transactionId,
        SagaStatus status,
        SagaStep currentStep,
        int retryCount,
        String failureReason,
        Instant startedAt,
        Instant updatedAt,
        Instant completedAt
) {
}

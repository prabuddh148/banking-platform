package com.banking.transaction.dto.response;

import com.banking.transaction.entity.SagaStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SagaStateResponse {

    private UUID transactionId;
    private String currentStep;
    private SagaStatus sagaStatus;
    private Instant createdAt;
    private Instant updatedAt;
}

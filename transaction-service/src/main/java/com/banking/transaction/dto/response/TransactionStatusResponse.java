package com.banking.transaction.dto.response;

import com.banking.transaction.entity.TransactionStatus;
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
public class TransactionStatusResponse {

    private UUID transactionId;
    private String referenceNumber;
    private TransactionStatus status;
    private Instant updatedAt;
}

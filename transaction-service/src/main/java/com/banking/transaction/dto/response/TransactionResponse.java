package com.banking.transaction.dto.response;

import com.banking.transaction.entity.TransactionStatus;
import com.banking.transaction.entity.TransactionType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TransactionResponse {

    private UUID id;
    private String referenceNumber;
    private TransactionType transactionType;
    private UUID sourceAccountId;
    private UUID targetAccountId;
    private BigDecimal amount;
    private String currency;
    private TransactionStatus status;
    private String description;
    private Instant initiatedAt;
    private Instant completedAt;
}

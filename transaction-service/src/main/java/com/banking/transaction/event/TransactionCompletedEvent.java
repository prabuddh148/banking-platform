package com.banking.transaction.event;

import com.banking.common.event.BaseEvent;
import com.banking.common.event.EventType;
import com.banking.transaction.entity.Transaction;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

import java.math.BigDecimal;
import java.util.UUID;

@Getter
@SuperBuilder
@NoArgsConstructor
public class TransactionCompletedEvent extends BaseEvent {

    private UUID transactionId;
    private String referenceNumber;
    private UUID sourceAccountId;
    private UUID targetAccountId;
    private BigDecimal amount;
    private String currency;

    public static TransactionCompletedEvent of(Transaction tx) {
        return TransactionCompletedEvent.builder()
                .eventType(EventType.TRANSACTION_COMPLETED.name())
                .aggregateId(tx.getId().toString())
                .transactionId(tx.getId())
                .referenceNumber(tx.getReferenceNumber())
                .sourceAccountId(tx.getSourceAccountId())
                .targetAccountId(tx.getTargetAccountId())
                .amount(tx.getAmount())
                .currency(tx.getCurrency())
                .build();
    }
}

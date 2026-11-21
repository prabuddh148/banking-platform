package com.banking.transaction.event;

import com.banking.common.event.BaseEvent;
import com.banking.common.event.EventType;
import com.banking.transaction.entity.Transaction;
import com.banking.transaction.entity.TransactionType;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

import java.math.BigDecimal;
import java.time.Instant;

/** Published when the money has moved successfully (saga finished OK). */
@Getter
@Setter
@NoArgsConstructor
@ToString(callSuper = true)
public class TransactionCompletedEvent extends BaseEvent {

    private String transactionId;
    private String reference;
    private TransactionType transactionType;
    private String sourceAccountId;
    private String destinationAccountId;
    private BigDecimal amount;
    private String currency;
    private String initiatedBy;
    private String description;
    private Instant completedAt;

    public TransactionCompletedEvent(Transaction tx) {
        super(EventType.TRANSACTION_COMPLETED, tx.getId().toString(), tx.getCorrelationId(), EventSources.TRANSACTION_SERVICE);
        this.transactionId = tx.getId().toString();
        this.reference = tx.getReference();
        this.transactionType = tx.getTransactionType();
        this.sourceAccountId = tx.getSourceAccountId();
        this.destinationAccountId = tx.getDestinationAccountId();
        this.amount = tx.getAmount();
        this.currency = tx.getCurrency();
        this.initiatedBy = tx.getInitiatedBy();
        this.description = tx.getDescription();
        this.completedAt = tx.getCompletedAt();
    }
}

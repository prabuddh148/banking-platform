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

/** Published when the saga ends in failure (fraud block, balance failure or timeout). */
@Getter
@Setter
@NoArgsConstructor
@ToString(callSuper = true)
public class TransactionFailedEvent extends BaseEvent {

    private String transactionId;
    private String reference;
    private TransactionType transactionType;
    private String sourceAccountId;
    private String destinationAccountId;
    private BigDecimal amount;
    private String currency;
    private String initiatedBy;
    private String failureReason;
    /** ErrorCode name, e.g. FRAUD_BLOCKED, INSUFFICIENT_FUNDS, TRANSACTION_FAILED. */
    private String failureCode;

    public TransactionFailedEvent(Transaction tx) {
        super(EventType.TRANSACTION_FAILED, tx.getId().toString(), tx.getCorrelationId(), EventSources.TRANSACTION_SERVICE);
        this.transactionId = tx.getId().toString();
        this.reference = tx.getReference();
        this.transactionType = tx.getTransactionType();
        this.sourceAccountId = tx.getSourceAccountId();
        this.destinationAccountId = tx.getDestinationAccountId();
        this.amount = tx.getAmount();
        this.currency = tx.getCurrency();
        this.initiatedBy = tx.getInitiatedBy();
        this.failureReason = tx.getFailureReason();
        this.failureCode = tx.getFailureCode();
    }
}

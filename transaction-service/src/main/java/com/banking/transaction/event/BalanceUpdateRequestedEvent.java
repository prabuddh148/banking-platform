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

/**
 * Published after fraud approval: asks account-service to debit/credit the accounts.
 * account-service answers with BALANCE_UPDATED or BALANCE_UPDATE_FAILED.
 */
@Getter
@Setter
@NoArgsConstructor
@ToString(callSuper = true)
public class BalanceUpdateRequestedEvent extends BaseEvent {

    private String transactionId;
    private String reference;
    private TransactionType transactionType;
    private String sourceAccountId;
    private String destinationAccountId;
    private BigDecimal amount;
    private String currency;
    private String initiatedBy;

    public BalanceUpdateRequestedEvent(Transaction tx) {
        super(EventType.BALANCE_UPDATE_REQUESTED, tx.getId().toString(), tx.getCorrelationId(), EventSources.TRANSACTION_SERVICE);
        this.transactionId = tx.getId().toString();
        this.reference = tx.getReference();
        this.transactionType = tx.getTransactionType();
        this.sourceAccountId = tx.getSourceAccountId();
        this.destinationAccountId = tx.getDestinationAccountId();
        this.amount = tx.getAmount();
        this.currency = tx.getCurrency();
        this.initiatedBy = tx.getInitiatedBy();
    }
}

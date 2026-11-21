package com.banking.account.event;

import com.banking.common.event.BaseEvent;
import com.banking.common.event.EventType;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

import java.math.BigDecimal;

/**
 * BALANCE_UPDATED (topic banking.account.events, key = transactionId).
 * Tells transaction-service that the money really moved, so it can complete the saga.
 */
@Getter
@Setter
@NoArgsConstructor
@ToString(callSuper = true)
@JsonIgnoreProperties(ignoreUnknown = true)
public class BalanceUpdatedEvent extends BaseEvent {

    private String transactionId;
    private String transactionType;
    private String sourceAccountId;
    private String destinationAccountId;
    private BigDecimal amount;
    private String currency;
    /** Ledger balance of the source after the debit (null when there is no source). */
    private BigDecimal sourceBalanceAfter;
    /** Ledger balance of the destination after the credit (null when there is no destination). */
    private BigDecimal destinationBalanceAfter;

    @Builder
    public BalanceUpdatedEvent(String transactionId, String transactionType, String sourceAccountId,
                               String destinationAccountId, BigDecimal amount, String currency,
                               BigDecimal sourceBalanceAfter, BigDecimal destinationBalanceAfter,
                               String correlationId) {
        super(EventType.BALANCE_UPDATED, transactionId, correlationId, EventSources.ACCOUNT_SERVICE);
        this.transactionId = transactionId;
        this.transactionType = transactionType;
        this.sourceAccountId = sourceAccountId;
        this.destinationAccountId = destinationAccountId;
        this.amount = amount;
        this.currency = currency;
        this.sourceBalanceAfter = sourceBalanceAfter;
        this.destinationBalanceAfter = destinationBalanceAfter;
    }
}

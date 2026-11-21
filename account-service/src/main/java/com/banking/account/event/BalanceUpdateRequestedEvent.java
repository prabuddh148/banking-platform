package com.banking.account.event;

import com.banking.common.event.BaseEvent;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

import java.math.BigDecimal;

/**
 * BALANCE_UPDATE_REQUESTED - produced by transaction-service (topic banking.transaction.events)
 * once fraud checks approved a transaction. account-service only READS this event
 * (Jackson fills it through the no-arg constructor and setters).
 */
@Getter
@Setter
@NoArgsConstructor
@ToString(callSuper = true)
@JsonIgnoreProperties(ignoreUnknown = true)
public class BalanceUpdateRequestedEvent extends BaseEvent {

    private String transactionId;
    private String reference;
    /** DEPOSIT, WITHDRAWAL or TRANSFER. */
    private String transactionType;
    /** Null for DEPOSIT. */
    private String sourceAccountId;
    /** Null for WITHDRAWAL. */
    private String destinationAccountId;
    private BigDecimal amount;
    private String currency;
    /** userId of the customer who started the transaction. */
    private String initiatedBy;
}

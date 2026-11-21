package com.banking.fraud.event;

import com.banking.common.event.BaseEvent;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

import java.math.BigDecimal;

/**
 * Incoming TRANSACTION_INITIATED event from transaction-service (aggregateId = transactionId).
 * Only read by this service, so it just needs a no-arg constructor and setters for Jackson.
 */
@Getter
@Setter
@ToString(callSuper = true)
@NoArgsConstructor
public class TransactionInitiatedEvent extends BaseEvent {

    private String transactionId;
    private String reference;
    /** DEPOSIT, WITHDRAWAL or TRANSFER */
    private String transactionType;
    /** null for deposits */
    private String sourceAccountId;
    /** null for withdrawals */
    private String destinationAccountId;
    private BigDecimal amount;
    private String currency;
    /** userId of the customer who started the transaction */
    private String initiatedBy;
    private String description;
    /** from the X-Client-Country header, may be null */
    private String clientCountry;

    /** The account whose behaviour we track: the money leaves it, or arrives for a deposit. */
    public String riskAccountId() {
        return sourceAccountId != null ? sourceAccountId : destinationAccountId;
    }
}

package com.banking.notification.event;

import com.banking.common.event.BaseEvent;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

import java.math.BigDecimal;

/**
 * TRANSACTION_FAILED as published by transaction-service.
 */
@Getter
@Setter
@NoArgsConstructor
@ToString(callSuper = true)
@JsonIgnoreProperties(ignoreUnknown = true)
public class TransactionFailedEvent extends BaseEvent {

    private String transactionId;
    private String reference;
    /** DEPOSIT, WITHDRAWAL or TRANSFER. */
    private String transactionType;
    private String sourceAccountId;
    private String destinationAccountId;
    private BigDecimal amount;
    private String currency;
    private String initiatedBy;
    private String failureReason;
    /** ErrorCode name, e.g. INSUFFICIENT_FUNDS or FRAUD_BLOCKED. */
    private String failureCode;
}

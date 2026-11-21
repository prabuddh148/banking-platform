package com.banking.notification.event;

import com.banking.common.event.BaseEvent;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * TRANSACTION_COMPLETED as published by transaction-service.
 * sourceAccountId is null for deposits, destinationAccountId is null for withdrawals.
 */
@Getter
@Setter
@NoArgsConstructor
@ToString(callSuper = true)
@JsonIgnoreProperties(ignoreUnknown = true)
public class TransactionCompletedEvent extends BaseEvent {

    private String transactionId;
    private String reference;
    /** DEPOSIT, WITHDRAWAL or TRANSFER. */
    private String transactionType;
    private String sourceAccountId;
    private String destinationAccountId;
    private BigDecimal amount;
    private String currency;
    private String initiatedBy;
    private String description;
    private Instant completedAt;
}

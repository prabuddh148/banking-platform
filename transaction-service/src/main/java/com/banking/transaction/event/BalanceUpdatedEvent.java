package com.banking.transaction.event;

import com.banking.common.event.BaseEvent;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

import java.math.BigDecimal;

/** Incoming BALANCE_UPDATED event from account-service: the money has moved. */
@Getter
@Setter
@NoArgsConstructor
@ToString(callSuper = true)
public class BalanceUpdatedEvent extends BaseEvent {

    private String transactionId;
    private String transactionType;
    private String sourceAccountId;
    private String destinationAccountId;
    private BigDecimal amount;
    private String currency;
    private BigDecimal sourceBalanceAfter;
    private BigDecimal destinationBalanceAfter;
}

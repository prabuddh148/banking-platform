package com.banking.notification.event;

import com.banking.common.event.BaseEvent;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

import java.math.BigDecimal;

/**
 * ACCOUNT_CREATED as published by account-service (only the fields this service reads).
 */
@Getter
@Setter
@NoArgsConstructor
@ToString(callSuper = true)
@JsonIgnoreProperties(ignoreUnknown = true)
public class AccountCreatedEvent extends BaseEvent {

    private String accountId;
    private String accountNumber;
    private String customerId;
    private String customerName;
    private String customerEmail;
    private String customerPhone;
    private String accountType;
    private String currency;
    private BigDecimal initialBalance;
}

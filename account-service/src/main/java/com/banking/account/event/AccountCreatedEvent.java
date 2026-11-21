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
 * ACCOUNT_CREATED (topic banking.account.events, key = accountId).
 * Consumed by notification-service (welcome email) and audit-service.
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

    @Builder
    public AccountCreatedEvent(String accountId, String accountNumber, String customerId, String customerName,
                               String customerEmail, String customerPhone, String accountType, String currency,
                               BigDecimal initialBalance, String correlationId) {
        super(EventType.ACCOUNT_CREATED, accountId, correlationId, EventSources.ACCOUNT_SERVICE);
        this.accountId = accountId;
        this.accountNumber = accountNumber;
        this.customerId = customerId;
        this.customerName = customerName;
        this.customerEmail = customerEmail;
        this.customerPhone = customerPhone;
        this.accountType = accountType;
        this.currency = currency;
        this.initialBalance = initialBalance;
    }
}

package com.banking.notification.event;

import com.banking.common.event.BaseEvent;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

/**
 * ACCOUNT_STATUS_CHANGED as published by account-service (freeze / unfreeze / close).
 */
@Getter
@Setter
@NoArgsConstructor
@ToString(callSuper = true)
@JsonIgnoreProperties(ignoreUnknown = true)
public class AccountStatusChangedEvent extends BaseEvent {

    private String accountId;
    private String accountNumber;
    private String customerId;
    private String customerEmail;
    private String customerName;
    private String previousStatus;
    private String newStatus;
    private String reason;
    private String changedBy;
}

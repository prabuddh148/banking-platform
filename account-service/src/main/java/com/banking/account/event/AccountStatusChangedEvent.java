package com.banking.account.event;

import com.banking.common.event.BaseEvent;
import com.banking.common.event.EventType;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

/**
 * ACCOUNT_STATUS_CHANGED (topic banking.account.events, key = accountId).
 * Sent when an account is frozen, unfrozen or closed.
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

    @Builder
    public AccountStatusChangedEvent(String accountId, String accountNumber, String customerId, String customerEmail,
                                     String customerName, String previousStatus, String newStatus, String reason,
                                     String changedBy, String correlationId) {
        super(EventType.ACCOUNT_STATUS_CHANGED, accountId, correlationId, EventSources.ACCOUNT_SERVICE);
        this.accountId = accountId;
        this.accountNumber = accountNumber;
        this.customerId = customerId;
        this.customerEmail = customerEmail;
        this.customerName = customerName;
        this.previousStatus = previousStatus;
        this.newStatus = newStatus;
        this.reason = reason;
        this.changedBy = changedBy;
    }
}

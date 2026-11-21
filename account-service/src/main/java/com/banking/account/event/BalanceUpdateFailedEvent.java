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
 * BALANCE_UPDATE_FAILED (topic banking.account.events, key = transactionId).
 * The balance update was rejected by a business rule; NO balance was changed.
 */
@Getter
@Setter
@NoArgsConstructor
@ToString(callSuper = true)
@JsonIgnoreProperties(ignoreUnknown = true)
public class BalanceUpdateFailedEvent extends BaseEvent {

    private String transactionId;
    private String reason;
    /** ErrorCode name, e.g. INSUFFICIENT_FUNDS, ACCOUNT_FROZEN, ACCOUNT_NOT_FOUND. */
    private String errorCode;

    @Builder
    public BalanceUpdateFailedEvent(String transactionId, String reason, String errorCode, String correlationId) {
        super(EventType.BALANCE_UPDATE_FAILED, transactionId, correlationId, EventSources.ACCOUNT_SERVICE);
        this.transactionId = transactionId;
        this.reason = reason;
        this.errorCode = errorCode;
    }
}

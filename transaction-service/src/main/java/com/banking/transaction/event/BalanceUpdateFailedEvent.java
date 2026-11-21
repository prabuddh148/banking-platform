package com.banking.transaction.event;

import com.banking.common.event.BaseEvent;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

/**
 * Incoming BALANCE_UPDATE_FAILED event from account-service: nothing was changed
 * (e.g. insufficient funds, frozen account).
 */
@Getter
@Setter
@NoArgsConstructor
@ToString(callSuper = true)
public class BalanceUpdateFailedEvent extends BaseEvent {

    private String transactionId;
    private String reason;
    /** ErrorCode name, e.g. INSUFFICIENT_FUNDS. */
    private String errorCode;
}

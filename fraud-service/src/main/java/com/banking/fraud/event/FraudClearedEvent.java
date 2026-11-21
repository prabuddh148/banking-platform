package com.banking.fraud.event;

import com.banking.common.event.EventType;
import com.banking.fraud.entity.Decision;
import lombok.NoArgsConstructor;

/**
 * FRAUD_CLEARED: the transaction may go ahead. Decision is always APPROVE.
 * Published automatically for low-risk transactions, or when an admin approves an alert.
 */
@NoArgsConstructor
public class FraudClearedEvent extends FraudResultEvent {

    public FraudClearedEvent(String transactionId, String correlationId) {
        super(EventType.FRAUD_CLEARED, transactionId, correlationId);
        setDecision(Decision.APPROVE);
    }
}

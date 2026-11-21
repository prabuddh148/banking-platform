package com.banking.fraud.event;

import com.banking.common.event.EventType;
import com.banking.fraud.entity.Decision;
import lombok.NoArgsConstructor;

/**
 * FRAUD_DETECTED: the transaction is suspicious. Decision REVIEW = wait for an admin,
 * BLOCK = the transaction must fail.
 */
@NoArgsConstructor
public class FraudDetectedEvent extends FraudResultEvent {

    public FraudDetectedEvent(String transactionId, String correlationId, Decision decision) {
        super(EventType.FRAUD_DETECTED, transactionId, correlationId);
        if (decision == Decision.APPROVE) {
            throw new IllegalArgumentException("FRAUD_DETECTED needs decision REVIEW or BLOCK");
        }
        setDecision(decision);
    }
}

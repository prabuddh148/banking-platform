package com.banking.transaction.event;

import com.banking.common.event.BaseEvent;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

import java.util.ArrayList;
import java.util.List;

/**
 * Incoming FRAUD_CLEARED / FRAUD_DETECTED event from fraud-service (one class for both:
 * the {@link #decision} field tells them apart).
 */
@Getter
@Setter
@NoArgsConstructor
@ToString(callSuper = true)
public class FraudDecisionReceivedEvent extends BaseEvent {

    /** What fraud-service wants us to do with the transaction. */
    public enum Decision {
        /** Go ahead (FRAUD_CLEARED). */
        APPROVE,
        /** Hold until an admin reviews it (FRAUD_DETECTED). */
        REVIEW,
        /** Reject (FRAUD_DETECTED). */
        BLOCK
    }

    private String transactionId;
    /** 0-100. */
    private Integer riskScore;
    /** LOW | MEDIUM | HIGH | CRITICAL. */
    private String riskLevel;
    private Decision decision;
    private List<String> triggeredRules = new ArrayList<>();
    private String reason;
    private String alertId;
    /** Set when an admin made the decision. */
    private String reviewedBy;
}

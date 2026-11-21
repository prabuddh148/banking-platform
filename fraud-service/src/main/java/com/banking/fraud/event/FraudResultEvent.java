package com.banking.fraud.event;

import com.banking.common.event.BaseEvent;
import com.banking.common.event.EventType;
import com.banking.fraud.entity.Decision;
import com.banking.fraud.entity.RiskLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

import java.util.ArrayList;
import java.util.List;

/**
 * Payload shared by FRAUD_CLEARED and FRAUD_DETECTED (aggregateId = transactionId).
 * The two concrete events only differ in their event type.
 */
@Getter
@Setter
@ToString(callSuper = true)
@NoArgsConstructor
public abstract class FraudResultEvent extends BaseEvent {

    public static final String SOURCE = "fraud-service";

    private String transactionId;
    private int riskScore;
    private RiskLevel riskLevel;
    private Decision decision;
    private List<String> triggeredRules = new ArrayList<>();
    private String reason;
    /** Id of the fraud alert, null when no alert was raised. */
    private String alertId;
    /** userId of the admin who decided, null for automatic decisions. */
    private String reviewedBy;

    protected FraudResultEvent(EventType type, String transactionId, String correlationId) {
        super(type, transactionId, correlationId, SOURCE);
        this.transactionId = transactionId;
    }
}

package com.banking.audit.entity;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Event types the audit-service knows about. Mirrors {@link com.banking.common.event.EventType}
 * plus {@link #UNKNOWN}, so an event type added later by another service is still recorded instead of
 * being rejected.
 * <p>
 * Each type also says what kind of thing ("aggregate") its {@code aggregateId} points to.
 * BALANCE_UPDATED / BALANCE_UPDATE_FAILED are produced by account-service, but their aggregateId is a
 * transactionId, so they belong to the TRANSACTION aggregate.
 */
@Getter
@RequiredArgsConstructor
public enum AuditEventType {

    ACCOUNT_CREATED(AggregateTypes.ACCOUNT),
    ACCOUNT_STATUS_CHANGED(AggregateTypes.ACCOUNT),
    BALANCE_UPDATED(AggregateTypes.TRANSACTION),
    BALANCE_UPDATE_FAILED(AggregateTypes.TRANSACTION),

    TRANSACTION_INITIATED(AggregateTypes.TRANSACTION),
    BALANCE_UPDATE_REQUESTED(AggregateTypes.TRANSACTION),
    TRANSACTION_COMPLETED(AggregateTypes.TRANSACTION),
    TRANSACTION_FAILED(AggregateTypes.TRANSACTION),

    FRAUD_DETECTED(AggregateTypes.FRAUD),
    FRAUD_CLEARED(AggregateTypes.FRAUD),

    NOTIFICATION_REQUESTED(AggregateTypes.NOTIFICATION),

    /** Any event type this service does not (yet) know about. */
    UNKNOWN(AggregateTypes.UNKNOWN);

    private final String aggregateType;

    /** Converts the {@code eventType} text of a message; unknown or missing values become {@link #UNKNOWN}. */
    public static AuditEventType fromName(String name) {
        if (name == null || name.isBlank()) {
            return UNKNOWN;
        }
        try {
            return valueOf(name.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return UNKNOWN;
        }
    }

    /** Values stored in the {@code aggregate_type} column. */
    public static final class AggregateTypes {
        public static final String ACCOUNT = "ACCOUNT";
        public static final String TRANSACTION = "TRANSACTION";
        public static final String FRAUD = "FRAUD";
        public static final String NOTIFICATION = "NOTIFICATION";
        public static final String UNKNOWN = "UNKNOWN";

        private AggregateTypes() {
        }
    }
}

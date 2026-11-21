package com.banking.common.event;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Every Kafka event in the platform, and the topic it travels on.
 */
@Getter
@RequiredArgsConstructor
public enum EventType {

    // account-service
    ACCOUNT_CREATED(Topics.ACCOUNT),
    ACCOUNT_STATUS_CHANGED(Topics.ACCOUNT),
    BALANCE_UPDATED(Topics.ACCOUNT),
    BALANCE_UPDATE_FAILED(Topics.ACCOUNT),

    // transaction-service
    TRANSACTION_INITIATED(Topics.TRANSACTION),
    BALANCE_UPDATE_REQUESTED(Topics.TRANSACTION),
    TRANSACTION_COMPLETED(Topics.TRANSACTION),
    TRANSACTION_FAILED(Topics.TRANSACTION),

    // fraud-service
    FRAUD_DETECTED(Topics.FRAUD),
    FRAUD_CLEARED(Topics.FRAUD),

    // anyone -> notification-service
    NOTIFICATION_REQUESTED(Topics.NOTIFICATION);

    private final String topic;

    /** Topic names as constants so they can be used inside annotations like @KafkaListener. */
    public static final class Topics {
        public static final String ACCOUNT = "banking.account.events";
        public static final String TRANSACTION = "banking.transaction.events";
        public static final String FRAUD = "banking.fraud.events";
        public static final String NOTIFICATION = "banking.notification.events";
        /** Suffix of the dead-letter topic for each topic, e.g. banking.account.events.DLT */
        public static final String DLT_SUFFIX = ".DLT";

        private Topics() {
        }
    }
}

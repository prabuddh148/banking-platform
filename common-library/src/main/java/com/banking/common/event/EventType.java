package com.banking.common.event;

import lombok.Getter;

@Getter
public enum EventType{
    //Account 
    ACCOUNT_CREATED(Topics.ACCOUNT),
    ACCOUNT_STATUS_CHANGED(Topics.ACCOUNT),

    //Transaction
    TRANSACTION_INITIATED(Topics.TRANSACTION),
    TRANSACTION_COMPLETED(Topics.TRANSACTION),
    TRANSACTION_FAILED(Topics.TRANSACTION),

    //fraud
    FRAUD_DETECTED(Topics.FRAUD),
    FRAUD_CLEARED(Topics.FRAUD),

    // Notification
    NOTIFICATION_REQUESTED(Topics.NOTIFICATION);

    private final String topic;

    EventType(String topic) {
        this.topic = topic;
    }

    public static class Topics {
        public static final String ACCOUNT = "banking.account.events";
        public static final String TRANSACTION = "banking.transaction.events";
        public static final String FRAUD = "banking.fraud.events";
        public static final String NOTIFICATION = "banking.notification.events";

        private Topics() {
            // Private constructor to prevent instantiation
        }
    }

}
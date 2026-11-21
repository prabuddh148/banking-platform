package com.banking.notification.exception;

import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;

/**
 * Thrown by a channel sender (email / SMS / push) when the message could not be delivered.
 * The notification service catches it and marks the notification FAILED - it never
 * escapes to the Kafka consumer.
 */
public class NotificationDeliveryException extends BankingException {

    public NotificationDeliveryException(String message) {
        super(ErrorCode.NOTIFICATION_DELIVERY_FAILED, message);
    }

    public NotificationDeliveryException(String message, Throwable cause) {
        super(ErrorCode.NOTIFICATION_DELIVERY_FAILED, message, cause);
    }
}

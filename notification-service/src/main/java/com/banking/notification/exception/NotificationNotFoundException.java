package com.banking.notification.exception;

import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;

import java.util.UUID;

/**
 * No notification with the given id (mapped to 404 by the global exception handler).
 */
public class NotificationNotFoundException extends BankingException {

    public NotificationNotFoundException(UUID id) {
        super(ErrorCode.NOTIFICATION_NOT_FOUND, "Notification not found: " + id);
    }
}

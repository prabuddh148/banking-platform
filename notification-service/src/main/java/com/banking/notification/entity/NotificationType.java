package com.banking.notification.entity;

/**
 * What a notification is about (the business reason it was sent).
 */
public enum NotificationType {
    /** A new account was opened. */
    WELCOME,
    /** Account was frozen, unfrozen or closed. */
    ACCOUNT_STATUS_CHANGED,
    /** Deposit / withdrawal / transfer finished successfully (sent to the main account holder). */
    TRANSACTION_COMPLETED,
    /** Transaction was rejected or failed. */
    TRANSACTION_FAILED,
    /** Money arrived through a transfer (sent to the receiving account holder). */
    MONEY_RECEIVED,
    /** Free-form notification requested by another service (NOTIFICATION_REQUESTED). */
    GENERAL;

    /** Parses a type name coming from an event; unknown or empty values become {@link #GENERAL}. */
    public static NotificationType fromString(String value) {
        if (value == null || value.isBlank()) {
            return GENERAL;
        }
        try {
            return NotificationType.valueOf(value.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return GENERAL;
        }
    }
}

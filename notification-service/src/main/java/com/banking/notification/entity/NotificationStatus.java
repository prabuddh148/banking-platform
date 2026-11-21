package com.banking.notification.entity;

/**
 * Lifecycle of a notification.
 * <ul>
 *     <li>PENDING - saved, not delivered yet</li>
 *     <li>SENT - the provider accepted it</li>
 *     <li>FAILED - delivery failed; the retry job tries again until the max attempts are used up</li>
 * </ul>
 */
public enum NotificationStatus {
    PENDING,
    SENT,
    FAILED
}

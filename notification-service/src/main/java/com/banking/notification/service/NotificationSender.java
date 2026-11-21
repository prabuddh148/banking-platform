package com.banking.notification.service;

import com.banking.notification.entity.Notification;
import com.banking.notification.entity.NotificationChannel;
import com.banking.notification.exception.NotificationDeliveryException;

/**
 * One delivery channel (email, SMS, push).
 * <p>
 * {@link NotificationServiceImpl} receives all implementations as a list and picks the one
 * whose {@link #channel()} matches the notification - adding a new channel means adding a
 * new bean, nothing else changes.
 */
public interface NotificationSender {

    NotificationChannel channel();

    /**
     * Delivers the notification.
     *
     * @throws NotificationDeliveryException when the provider rejects it or is unreachable
     */
    void send(Notification notification);
}

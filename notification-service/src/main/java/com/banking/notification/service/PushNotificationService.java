package com.banking.notification.service;

import com.banking.notification.entity.Notification;
import com.banking.notification.entity.NotificationChannel;
import com.banking.notification.exception.NotificationDeliveryException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * Simulated push provider: instead of calling Firebase / APNs it logs the message.
 * The "address" of a push notification is the user id (the user's devices).
 */
@Slf4j
@Service
public class PushNotificationService implements NotificationSender {

    @Override
    public NotificationChannel channel() {
        return NotificationChannel.PUSH;
    }

    @Override
    public void send(Notification notification) {
        String userId = notification.getRecipientAddress();
        if (userId == null || userId.isBlank()) {
            throw new NotificationDeliveryException("No push recipient for notification " + notification.getId());
        }
        log.info("[SIMULATED PUSH] to user {}: {} - {}", userId, notification.getSubject(), notification.getMessage());
    }
}

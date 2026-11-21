package com.banking.notification.dto;

import com.banking.notification.entity.NotificationChannel;
import com.banking.notification.entity.NotificationType;
import lombok.Builder;

/**
 * Internal "please send this" instruction: everything needed to create and deliver
 * one notification on one channel. Built by the service from an incoming event.
 *
 * @param recipientId      customer (userId) the notification belongs to
 * @param channel          EMAIL / SMS / PUSH
 * @param type             business reason
 * @param recipientAddress email, phone or user id (push), depending on the channel
 * @param subject          subject line (email / push title)
 * @param message          plain-text body
 * @param htmlBody         rendered HTML (EMAIL only, may be null)
 * @param referenceId      accountId / transactionId the notification is about
 * @param eventId          id of the event that caused it
 */
@Builder
public record NotificationCommand(
        String recipientId,
        NotificationChannel channel,
        NotificationType type,
        String recipientAddress,
        String subject,
        String message,
        String htmlBody,
        String referenceId,
        String eventId
) {
}

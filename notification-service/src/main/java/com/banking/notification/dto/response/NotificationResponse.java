package com.banking.notification.dto.response;

import com.banking.notification.entity.NotificationChannel;
import com.banking.notification.entity.NotificationStatus;
import com.banking.notification.entity.NotificationType;
import lombok.Builder;

import java.time.Instant;
import java.util.UUID;

/**
 * What the REST API returns for a notification.
 * {@code recipient} is the masked email / phone, never the full address.
 */
@Builder
public record NotificationResponse(
        UUID id,
        String recipientId,
        NotificationChannel channel,
        NotificationType type,
        NotificationStatus status,
        String subject,
        String message,
        String recipient,
        int attempts,
        String errorMessage,
        Instant createdAt,
        Instant sentAt,
        Instant readAt
) {
}

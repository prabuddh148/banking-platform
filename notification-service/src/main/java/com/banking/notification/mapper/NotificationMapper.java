package com.banking.notification.mapper;

import com.banking.common.util.MaskingUtil;
import com.banking.notification.dto.response.NotificationResponse;
import com.banking.notification.entity.Notification;
import org.springframework.stereotype.Component;

/**
 * Converts {@link Notification} entities into API responses.
 * Written by hand (no MapStruct) because the only non-trivial part is masking the recipient.
 */
@Component
public class NotificationMapper {

    public NotificationResponse toResponse(Notification notification) {
        return NotificationResponse.builder()
                .id(notification.getId())
                .recipientId(notification.getRecipientId())
                .channel(notification.getChannel())
                .type(notification.getType())
                .status(notification.getStatus())
                .subject(notification.getSubject())
                .message(notification.getMessage())
                .recipient(maskRecipient(notification))
                .attempts(notification.getAttempts())
                .errorMessage(notification.getErrorMessage())
                .createdAt(notification.getCreatedAt())
                .sentAt(notification.getSentAt())
                .readAt(notification.getReadAt())
                .build();
    }

    /** Email -> r****@example.com, phone -> ******3210, push -> the user id (not sensitive). */
    private String maskRecipient(Notification notification) {
        String address = notification.getRecipientAddress();
        if (address == null || notification.getChannel() == null) {
            return address;
        }
        return switch (notification.getChannel()) {
            case EMAIL -> MaskingUtil.maskEmail(address);
            case SMS -> MaskingUtil.maskPhone(address);
            case PUSH -> address;
        };
    }
}

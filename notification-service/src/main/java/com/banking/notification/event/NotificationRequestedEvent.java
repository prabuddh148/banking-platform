package com.banking.notification.event;

import com.banking.common.event.BaseEvent;
import com.banking.common.event.EventType;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

/**
 * NOTIFICATION_REQUESTED (topic banking.notification.events): any service can ask us to send
 * a free-form message. aggregateId = recipientId.
 */
@Getter
@Setter
@NoArgsConstructor
@ToString(callSuper = true)
@JsonIgnoreProperties(ignoreUnknown = true)
public class NotificationRequestedEvent extends BaseEvent {

    private String recipientId;
    private String recipientEmail;
    private String recipientPhone;
    /** EMAIL, SMS or PUSH. */
    private String channel;
    /** One of {@code NotificationType}; unknown values are treated as GENERAL. */
    private String notificationType;
    private String subject;
    private String message;

    public NotificationRequestedEvent(String recipientId, String correlationId, String source) {
        super(EventType.NOTIFICATION_REQUESTED, recipientId, correlationId, source);
        this.recipientId = recipientId;
    }
}

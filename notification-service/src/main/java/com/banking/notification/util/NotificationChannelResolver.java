package com.banking.notification.util;

import com.banking.notification.entity.NotificationChannel;
import com.banking.notification.template.NotificationTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Decides on which channels a notification is sent.
 * <p>
 * Rules: account notifications go by EMAIL; money movements go by EMAIL and SMS
 * (customers expect an instant text for those). A channel is skipped when we have
 * no address for it (no email / no phone on file).
 */
@Component
public class NotificationChannelResolver {

    public List<NotificationChannel> resolve(NotificationTemplate template, String email, String phone) {
        List<NotificationChannel> wanted = switch (template) {
            case WELCOME, ACCOUNT_STATUS_CHANGED, GENERIC -> List.of(NotificationChannel.EMAIL);
            case TRANSACTION_COMPLETED, TRANSACTION_FAILED, MONEY_RECEIVED ->
                    List.of(NotificationChannel.EMAIL, NotificationChannel.SMS);
        };
        List<NotificationChannel> result = new ArrayList<>();
        for (NotificationChannel channel : wanted) {
            if (channel == NotificationChannel.EMAIL && hasText(email)
                    || channel == NotificationChannel.SMS && hasText(phone)
                    || channel == NotificationChannel.PUSH) {
                result.add(channel);
            }
        }
        return result;
    }

    /**
     * Parses the channel of a NOTIFICATION_REQUESTED event. Empty means EMAIL.
     *
     * @throws IllegalArgumentException for an unknown channel (the event then goes to the DLT)
     */
    public NotificationChannel parse(String channel) {
        if (!hasText(channel)) {
            return NotificationChannel.EMAIL;
        }
        try {
            return NotificationChannel.valueOf(channel.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Unknown notification channel: " + channel, e);
        }
    }

    /** The address to use for a channel: email for EMAIL, phone for SMS, the user id for PUSH. */
    public String addressFor(NotificationChannel channel, String recipientId, String email, String phone) {
        return switch (channel) {
            case EMAIL -> email;
            case SMS -> phone;
            case PUSH -> recipientId;
        };
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}

package com.banking.notification.service;

import com.banking.common.util.MaskingUtil;
import com.banking.notification.entity.Notification;
import com.banking.notification.entity.NotificationChannel;
import com.banking.notification.exception.NotificationDeliveryException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * Simulated SMS provider: instead of calling a real gateway (Twilio etc.) it logs the text.
 * It still validates the phone number, so a missing number shows up as a FAILED notification.
 */
@Slf4j
@Service
public class SmsNotificationService implements NotificationSender {

    @Override
    public NotificationChannel channel() {
        return NotificationChannel.SMS;
    }

    @Override
    public void send(Notification notification) {
        String phone = notification.getRecipientAddress();
        if (phone == null || !phone.replaceAll("[\\s-]", "").matches("\\+?\\d{7,15}")) {
            throw new NotificationDeliveryException("Invalid or missing phone number for recipient "
                    + notification.getRecipientId());
        }
        log.info("[SIMULATED SMS] to {}: {}", MaskingUtil.maskPhone(phone), notification.getMessage());
    }
}

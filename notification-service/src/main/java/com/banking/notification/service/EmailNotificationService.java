package com.banking.notification.service;

import com.banking.common.util.MaskingUtil;
import com.banking.notification.config.MailConfig;
import com.banking.notification.entity.Notification;
import com.banking.notification.entity.NotificationChannel;
import com.banking.notification.exception.NotificationDeliveryException;
import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;

/**
 * Sends EMAIL notifications through SMTP using Spring's {@link JavaMailSender}.
 * The mail has an HTML part (rendered Thymeleaf template) and a plain-text part.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EmailNotificationService implements NotificationSender {

    private final JavaMailSender mailSender;
    private final MailConfig.MailProperties mailProperties;

    @Override
    public NotificationChannel channel() {
        return NotificationChannel.EMAIL;
    }

    @Override
    public void send(Notification notification) {
        String to = notification.getRecipientAddress();
        if (to == null || to.isBlank()) {
            throw new NotificationDeliveryException("No email address for recipient " + notification.getRecipientId());
        }
        try {
            MimeMessage mime = mailSender.createMimeMessage();
            // true = multipart, so we can attach both a plain-text and an HTML version
            MimeMessageHelper helper = new MimeMessageHelper(mime, true, StandardCharsets.UTF_8.name());
            helper.setFrom(mailProperties.from(), mailProperties.fromName());
            helper.setTo(to);
            helper.setSubject(notification.getSubject() == null ? "" : notification.getSubject());
            String text = notification.getMessage() == null ? "" : notification.getMessage();
            if (notification.getHtmlBody() != null) {
                helper.setText(text, notification.getHtmlBody());
            } else {
                helper.setText(text, false);
            }
            mailSender.send(mime);
            log.info("Email sent to {} (notification {})", MaskingUtil.maskEmail(to), notification.getId());
        } catch (Exception e) {
            // MessagingException, MailException, UnsupportedEncodingException ...
            throw new NotificationDeliveryException("Email delivery failed: " + e.getMessage(), e);
        }
    }
}

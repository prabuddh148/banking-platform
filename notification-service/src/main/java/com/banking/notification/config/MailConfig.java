package com.banking.notification.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.context.annotation.Configuration;

/**
 * Email settings.
 * <p>
 * The SMTP connection itself ({@code JavaMailSender}) is created by Spring Boot from the
 * {@code spring.mail.*} properties (MailHog on localhost:1025 by default). This class only adds
 * our own settings under {@code notification.mail.*}: the sender address and display name.
 */
@Configuration
@EnableConfigurationProperties(MailConfig.MailProperties.class)
public class MailConfig {

    /**
     * @param from     address emails are sent from
     * @param fromName display name shown in the mail client
     */
    @ConfigurationProperties(prefix = "notification.mail")
    public record MailProperties(
            @DefaultValue("no-reply@meridian.bank") String from,
            @DefaultValue("Meridian Bank") String fromName) {
    }
}

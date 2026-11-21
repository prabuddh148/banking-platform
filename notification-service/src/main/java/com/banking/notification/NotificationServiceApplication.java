package com.banking.notification;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Entry point of the notification-service.
 * <p>
 * It listens to account, transaction and notification events on Kafka and turns them into
 * email (real SMTP), SMS and push (simulated) notifications, and exposes a small REST API
 * so customers can see their notifications.
 */
@SpringBootApplication
public class NotificationServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(NotificationServiceApplication.class, args);
    }
}

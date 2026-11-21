package com.banking.notification.entity;

/**
 * How a notification reaches the customer.
 * EMAIL is sent through SMTP; SMS and PUSH are simulated (logged) in this project.
 */
public enum NotificationChannel {
    EMAIL,
    SMS,
    PUSH
}

package com.banking.notification.service;

import com.banking.common.dto.PagedResponse;
import com.banking.notification.dto.NotificationCommand;
import com.banking.notification.dto.response.NotificationResponse;
import com.banking.notification.entity.Notification;
import com.banking.notification.entity.NotificationChannel;
import com.banking.notification.entity.NotificationStatus;
import com.banking.notification.event.AccountCreatedEvent;
import com.banking.notification.event.AccountStatusChangedEvent;
import com.banking.notification.event.NotificationRequestedEvent;
import com.banking.notification.event.TransactionCompletedEvent;
import com.banking.notification.event.TransactionFailedEvent;

import java.util.UUID;

/**
 * Business logic of the notification-service.
 * <ul>
 *     <li>{@code handle*} methods are called by the Kafka consumers, one per event type. They are
 *     idempotent (an event id is processed only once) and never throw because of a delivery problem -
 *     a failed delivery is stored as a FAILED notification instead.</li>
 *     <li>The query / retry / read methods back the REST API and enforce ownership.</li>
 * </ul>
 */
public interface NotificationService {

    /** Stores the account owner's contact details and sends a welcome email. */
    void handleAccountCreated(AccountCreatedEvent event);

    /** Emails the owner that the account was frozen / unfrozen / closed. */
    void handleAccountStatusChanged(AccountStatusChangedEvent event);

    /** Notifies the account holder (EMAIL + SMS) and, for transfers, the receiving account holder. */
    void handleTransactionCompleted(TransactionCompletedEvent event);

    /** Notifies the account holder (EMAIL + SMS) that the transaction failed. */
    void handleTransactionFailed(TransactionFailedEvent event);

    /** Sends a free-form notification another service asked for. */
    void handleNotificationRequested(NotificationRequestedEvent event);

    /** Saves a new notification and tries to deliver it right away. */
    Notification send(NotificationCommand command);

    /** Customers see only their own notifications; admins see all and may filter by recipient. */
    PagedResponse<NotificationResponse> getNotifications(String recipientId, NotificationStatus status,
                                                         NotificationChannel channel, int page, int size);

    /** One notification (owner or admin). */
    NotificationResponse getNotification(UUID id);

    /** Admin: re-sends a FAILED notification immediately. */
    NotificationResponse retry(UUID id);

    /** Owner: marks the notification as read. */
    NotificationResponse markAsRead(UUID id);

    /** Scheduled job: re-sends FAILED notifications that still have attempts left. */
    void retryFailedNotifications();
}

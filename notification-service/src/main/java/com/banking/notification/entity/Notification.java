package com.banking.notification.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

import java.time.Instant;
import java.util.UUID;

/**
 * One message sent (or to be sent) to one customer over one channel.
 * <p>
 * Everything needed to (re)send it is stored on the row - address, subject, text and, for
 * emails, the rendered HTML - so the retry job can resend it without the original event.
 */
@Entity
@Table(name = "notifications")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@ToString(exclude = {"message", "htmlBody"})
public class Notification {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** The customer (userId) this notification belongs to. */
    @Column(name = "recipient_id", nullable = false, length = 64)
    private String recipientId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private NotificationChannel channel;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private NotificationType type;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private NotificationStatus status;

    /** Email address, phone number or (for push) the user id - depending on the channel. */
    @Column(name = "recipient_address", length = 255)
    private String recipientAddress;

    @Column(length = 255)
    private String subject;

    /** Plain-text body (SMS text / push text / plain-text part of the email). */
    @Column(columnDefinition = "TEXT")
    private String message;

    /** Rendered HTML body, only for EMAIL. */
    @Column(name = "html_body", columnDefinition = "TEXT")
    private String htmlBody;

    /** Business id the notification is about, e.g. an accountId or transactionId. */
    @Column(name = "reference_id", length = 64)
    private String referenceId;

    /** Id of the Kafka event that caused this notification. */
    @Column(name = "event_id", length = 64)
    private String eventId;

    /** How many delivery attempts were made so far. */
    @Column(nullable = false)
    private int attempts;

    @Column(name = "error_message", length = 1000)
    private String errorMessage;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "last_attempt_at")
    private Instant lastAttemptAt;

    @Column(name = "sent_at")
    private Instant sentAt;

    @Column(name = "read_at")
    private Instant readAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
        if (status == null) {
            status = NotificationStatus.PENDING;
        }
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }
}

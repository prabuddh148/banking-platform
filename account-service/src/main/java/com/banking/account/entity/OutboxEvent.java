package com.banking.account.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * Transactional outbox row. An event is written here in the SAME database transaction as the
 * business change; {@code OutboxEventRelay} later sends it to Kafka. This way we never publish
 * an event for a change that was rolled back, and never lose an event for a committed change.
 */
@Entity
@Table(name = "outbox_events")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OutboxEvent {

    public static final int MAX_ATTEMPTS = 5;

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** e.g. "Account" or "Transaction". */
    @Column(name = "aggregate_type", nullable = false, length = 50)
    private String aggregateType;

    /** Used as the Kafka message key. */
    @Column(name = "aggregate_id", nullable = false, length = 64)
    private String aggregateId;

    @Column(name = "event_type", nullable = false, length = 50)
    private String eventType;

    @Column(name = "topic", nullable = false, length = 100)
    private String topic;

    /** The event serialized as JSON. */
    @Column(name = "payload", nullable = false, columnDefinition = "TEXT")
    private String payload;

    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    private OutboxStatus status = OutboxStatus.PENDING;

    @Builder.Default
    @Column(name = "attempts", nullable = false)
    private int attempts = 0;

    @Column(name = "last_error", columnDefinition = "TEXT")
    private String lastError;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "published_at")
    private Instant publishedAt;

    public void markPublished() {
        this.status = OutboxStatus.PUBLISHED;
        this.publishedAt = Instant.now();
        this.lastError = null;
    }

    /** Records a failed send; after {@link #MAX_ATTEMPTS} the row is given up (FAILED). */
    public void markAttemptFailed(String error) {
        this.attempts++;
        this.lastError = error;
        if (this.attempts >= MAX_ATTEMPTS) {
            this.status = OutboxStatus.FAILED;
        }
    }
}

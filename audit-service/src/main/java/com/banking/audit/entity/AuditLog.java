package com.banking.audit.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.ToString;
import org.hibernate.annotations.Immutable;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.Instant;
import java.util.UUID;

/**
 * One recorded platform event. Rows are write-once:
 * <ul>
 *   <li>{@link Immutable} tells Hibernate never to issue UPDATEs for this entity,</li>
 *   <li>there are no setters, and</li>
 *   <li>a database trigger (see V1__create_audit_schema.sql) rejects UPDATE and DELETE.</li>
 * </ul>
 */
@Entity
@Immutable
@Table(name = "audit_logs")
@EntityListeners(AuditingEntityListener.class)
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@ToString
public class AuditLog {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** eventId of the Kafka event; unique so the same event is never recorded twice. */
    @Column(name = "event_id", nullable = false, unique = true, length = 100)
    private String eventId;

    @Enumerated(EnumType.STRING)
    @Column(name = "event_type", nullable = false, length = 50)
    private AuditEventType eventType;

    /** The original eventType text (useful when eventType is UNKNOWN). */
    @Column(name = "raw_event_type", length = 100)
    private String rawEventType;

    @Column(name = "aggregate_id", length = 100)
    private String aggregateId;

    @Column(name = "aggregate_type", nullable = false, length = 30)
    private String aggregateType;

    /** Who caused the event (a user id) or "system". */
    @Column(name = "actor", nullable = false, length = 100)
    private String actor;

    /** Human readable description, e.g. "Transaction TXN... of 500.00 INR completed". */
    @Column(name = "action", nullable = false, length = 500)
    private String action;

    @Enumerated(EnumType.STRING)
    @Column(name = "severity", nullable = false, length = 20)
    private AuditSeverity severity;

    @Column(name = "source_service", length = 100)
    private String sourceService;

    @Column(name = "correlation_id", length = 100)
    private String correlationId;

    /** Event payload as JSON text, with personal data (emails, phones, account numbers) masked. */
    @Column(name = "details", columnDefinition = "TEXT")
    private String details;

    /** When the event happened (from the event). */
    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    /** When this service stored it. */
    @CreatedDate
    @Column(name = "recorded_at", nullable = false, updatable = false)
    private Instant recordedAt;
}

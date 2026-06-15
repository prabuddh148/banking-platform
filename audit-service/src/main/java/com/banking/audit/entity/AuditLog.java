package com.banking.audit.entity;

import jakarta.persistence.*;
import lombok.*;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "audit_logs", schema = "audit")
@EntityListeners(AuditingEntityListener.class)
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AuditLog {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    @Enumerated(EnumType.STRING)
    @Column(name = "event_type", nullable = false)
    private AuditEventType eventType;

    @Enumerated(EnumType.STRING)
    @Column(name = "severity", nullable = false)
    @Builder.Default
    private AuditSeverity severity = AuditSeverity.INFO;

    @Column(name = "actor_id")
    private UUID actorId;

    @Column(name = "actor_type")
    private String actorType;

    @Column(name = "resource_type")
    private String resourceType;

    @Column(name = "resource_id")
    private UUID resourceId;

    @Column(name = "action")
    private String action;

    @Column(name = "description", length = 1000)
    private String description;

    @Column(name = "old_value", columnDefinition = "jsonb")
    private String oldValue;

    @Column(name = "new_value", columnDefinition = "jsonb")
    private String newValue;

    @Column(name = "metadata", columnDefinition = "jsonb")
    private String metadata;

    @Column(name = "source_service")
    private String sourceService;

    @Column(name = "correlation_id")
    private String correlationId;

    @Column(name = "ip_address")
    private String ipAddress;

    @Column(name = "user_agent")
    private String userAgent;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    @CreatedDate
    @Column(name = "recorded_at", updatable = false)
    private Instant recordedAt;
}

package com.banking.transaction.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "outbox_events", schema = "transactions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class OutboxEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    @Column(name = "aggregate_type")
    private String aggregateType;

    @Column(name = "aggregate_id")
    private UUID aggregateId;

    @Column(name = "event_type")
    private String eventType;

    @Column(name = "payload", columnDefinition = "jsonb")
    private String payload;

    @Column(name = "topic")
    private String topic;

    @Column(name = "partition_key")
    private String partitionKey;

    @Enumerated(EnumType.STRING)
    @Column(name = "status")
    private OutboxStatus status;

    @Column(name = "retry_count")
    private int retryCount;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "published_at")
    private Instant publishedAt;
}

package com.banking.transaction.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "transaction_audit", schema = "transactions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TransactionAudit {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    @Column(name = "transaction_id", nullable = false)
    private UUID transactionId;

    @Column(name = "event_type")
    private String eventType;

    @Column(name = "actor")
    private String actor;

    @Column(name = "payload", columnDefinition = "jsonb")
    private String payload;

    @Column(name = "recorded_at")
    private Instant recordedAt;
}

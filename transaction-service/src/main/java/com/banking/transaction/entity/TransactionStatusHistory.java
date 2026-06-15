package com.banking.transaction.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "transaction_status_history", schema = "transactions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TransactionStatusHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    @Column(name = "transaction_id", nullable = false)
    private UUID transactionId;

    @Enumerated(EnumType.STRING)
    @Column(name = "previous_status")
    private TransactionStatus previousStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "new_status")
    private TransactionStatus newStatus;

    @Column(name = "reason")
    private String reason;

    @Column(name = "recorded_at")
    private Instant recordedAt;
}

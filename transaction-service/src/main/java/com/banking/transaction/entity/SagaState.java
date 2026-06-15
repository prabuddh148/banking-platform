package com.banking.transaction.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "saga_state", schema = "transactions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SagaState {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    @Column(name = "transaction_id", unique = true, nullable = false)
    private UUID transactionId;

    @Column(name = "current_step")
    private String currentStep;

    @Enumerated(EnumType.STRING)
    @Column(name = "saga_status")
    private SagaStatus sagaStatus;

    @Column(name = "step_data", columnDefinition = "jsonb")
    private String stepData;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;
}

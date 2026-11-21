package com.banking.transaction.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * Local audit trail of what happened to a transaction and who/what caused it
 * (the user, fraud-service, account-service, the timeout job...).
 * The platform-wide audit lives in audit-service; this is the service's own record.
 */
@Entity
@Table(name = "transaction_audit")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TransactionAudit {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "transaction_id", nullable = false)
    private UUID transactionId;

    /** Short verb, e.g. INITIATED, FRAUD_DECISION, BALANCE_UPDATED, TIMED_OUT. */
    @Column(nullable = false, length = 50)
    private String action;

    /** userId or service name. */
    @Column(nullable = false, length = 64)
    private String actor;

    @Column(length = 1000)
    private String details;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
}

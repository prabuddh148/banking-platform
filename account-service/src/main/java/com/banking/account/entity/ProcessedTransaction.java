package com.banking.account.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.springframework.data.domain.Persistable;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Ledger of balance updates already handled, one row per transactionId.
 * <p>
 * This is what makes the BALANCE_UPDATE_REQUESTED consumer idempotent: Kafka may deliver the
 * same message twice, but the second time we find this row and do nothing. The primary key on
 * {@code transaction_id} is the final safety net — a second insert for the same transaction
 * fails and rolls back the whole (duplicate) balance change.
 * <p>
 * Implements {@link Persistable} so that {@code save()} always INSERTs (never silently merges
 * over an existing row).
 */
@Entity
@Table(name = "processed_transactions")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProcessedTransaction implements Persistable<String> {

    @Id
    @Column(name = "transaction_id", length = 64)
    private String transactionId;

    @Column(name = "transaction_type", length = 20)
    private String transactionType;

    @Enumerated(EnumType.STRING)
    @Column(name = "outcome", nullable = false, length = 20)
    private BalanceUpdateOutcome outcome;

    /** ErrorCode name when outcome = FAILED. */
    @Column(name = "error_code", length = 50)
    private String errorCode;

    @Column(name = "source_account_id")
    private UUID sourceAccountId;

    @Column(name = "destination_account_id")
    private UUID destinationAccountId;

    @Column(name = "amount", precision = 19, scale = 2)
    private BigDecimal amount;

    @Column(name = "source_balance_after", precision = 19, scale = 2)
    private BigDecimal sourceBalanceAfter;

    @Column(name = "destination_balance_after", precision = 19, scale = 2)
    private BigDecimal destinationBalanceAfter;

    @CreationTimestamp
    @Column(name = "processed_at", nullable = false, updatable = false)
    private Instant processedAt;

    @Transient
    @Builder.Default
    private boolean isNew = true;

    @Override
    public String getId() {
        return transactionId;
    }

    @Override
    public boolean isNew() {
        return isNew;
    }

    @PostLoad
    @PostPersist
    void markNotNew() {
        this.isNew = false;
    }
}

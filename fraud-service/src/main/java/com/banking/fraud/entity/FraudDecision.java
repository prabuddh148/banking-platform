package com.banking.fraud.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * The result of the fraud check for ONE transaction (exactly one row per transactionId - the unique
 * constraint also makes event processing idempotent). Past decisions are also the "history" used by
 * the velocity and pattern-anomaly rules.
 * <p>
 * {@code decision} starts as the automatic outcome; when an admin reviews the alert it is updated to
 * the final outcome (APPROVE or BLOCK) and {@code reviewedBy} is set.
 */
@Entity
@Table(name = "fraud_decisions")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FraudDecision {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "transaction_id", nullable = false, unique = true, length = 64)
    private String transactionId;

    /** Account the risk is tracked for: the source account, or the destination for deposits. */
    @Column(name = "account_id", length = 64)
    private String accountId;

    @Column(name = "transaction_type", length = 20)
    private String transactionType;

    @Column(nullable = false, precision = 19, scale = 2)
    private BigDecimal amount;

    @Column(length = 3)
    private String currency;

    @Column(name = "initiated_by", length = 64)
    private String initiatedBy;

    @Column(name = "client_country", length = 8)
    private String clientCountry;

    @Column(name = "risk_score", nullable = false)
    private int riskScore;

    @Enumerated(EnumType.STRING)
    @Column(name = "risk_level", nullable = false, length = 20)
    private RiskLevel riskLevel;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Decision decision;

    @Builder.Default
    @Convert(converter = StringListConverter.class)
    @Column(name = "triggered_rules", columnDefinition = "TEXT")
    private List<String> triggeredRules = new ArrayList<>();

    @Column(columnDefinition = "TEXT")
    private String reason;

    /** Copied from the incoming event so the events we publish belong to the same flow. */
    @Column(name = "correlation_id", length = 64)
    private String correlationId;

    @Column(name = "reviewed_by", length = 64)
    private String reviewedBy;

    @Column(name = "evaluated_at", nullable = false)
    private Instant evaluatedAt;

    @PrePersist
    void onCreate() {
        if (evaluatedAt == null) {
            evaluatedAt = Instant.now();
        }
    }
}

package com.banking.fraud.repository;

import com.banking.fraud.entity.FraudDecision;
import com.banking.fraud.entity.RiskLevel;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Database access for {@link FraudDecision}. Also the source of account history for the rules.
 */
public interface FraudDecisionRepository extends JpaRepository<FraudDecision, UUID> {

    boolean existsByTransactionId(String transactionId);

    Optional<FraudDecision> findByTransactionId(String transactionId);

    /** How many transactions this account had since {@code since} (velocity rule). */
    long countByAccountIdAndEvaluatedAtAfter(String accountId, Instant since);

    /** Most recent decisions of an account, newest first; the page size limits how many (pattern rule). */
    List<FraudDecision> findByAccountIdOrderByEvaluatedAtDesc(String accountId, Pageable pageable);

    long countByRiskLevel(RiskLevel riskLevel);
}

package com.banking.transaction.repository;

import com.banking.transaction.entity.Transaction;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;
import java.util.UUID;

/**
 * Data access for {@link Transaction}. {@link JpaSpecificationExecutor} lets the list endpoint
 * combine optional filters (see {@link TransactionSpecifications}).
 */
public interface TransactionRepository extends JpaRepository<Transaction, UUID>, JpaSpecificationExecutor<Transaction> {

    Optional<Transaction> findByReference(String reference);

    boolean existsByReference(String reference);

    /** Used for Idempotency-Key support: same user + same key = same transaction. */
    Optional<Transaction> findByInitiatedByAndIdempotencyKey(String initiatedBy, String idempotencyKey);
}

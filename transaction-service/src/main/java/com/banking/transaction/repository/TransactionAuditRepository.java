package com.banking.transaction.repository;

import com.banking.transaction.entity.TransactionAudit;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/** Data access for {@link TransactionAudit}. */
public interface TransactionAuditRepository extends JpaRepository<TransactionAudit, Long> {

    List<TransactionAudit> findByTransactionIdOrderByCreatedAtAsc(UUID transactionId);
}

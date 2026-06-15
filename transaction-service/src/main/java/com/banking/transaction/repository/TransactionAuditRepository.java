package com.banking.transaction.repository;

import com.banking.transaction.entity.TransactionAudit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface TransactionAuditRepository extends JpaRepository<TransactionAudit, UUID> {

    List<TransactionAudit> findByTransactionIdOrderByRecordedAtDesc(UUID transactionId);
}

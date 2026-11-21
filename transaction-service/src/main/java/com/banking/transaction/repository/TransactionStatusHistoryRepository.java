package com.banking.transaction.repository;

import com.banking.transaction.entity.TransactionStatusHistory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/** Data access for {@link TransactionStatusHistory}. */
public interface TransactionStatusHistoryRepository extends JpaRepository<TransactionStatusHistory, Long> {

    /** Oldest first; id breaks ties when two changes share a timestamp. */
    List<TransactionStatusHistory> findByTransactionIdOrderByChangedAtAscIdAsc(UUID transactionId);
}

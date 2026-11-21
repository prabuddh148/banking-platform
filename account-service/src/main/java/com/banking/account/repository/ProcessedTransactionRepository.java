package com.banking.account.repository;

import com.banking.account.entity.ProcessedTransaction;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Ledger of handled BALANCE_UPDATE_REQUESTED events (keyed by transactionId) — used for idempotency.
 */
public interface ProcessedTransactionRepository extends JpaRepository<ProcessedTransaction, String> {
}

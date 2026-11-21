package com.banking.transaction.entity;

/**
 * Lifecycle of a transaction as the customer sees it.
 * <pre>
 * PENDING --(fraud APPROVE)--> PROCESSING --(balance updated)--> COMPLETED
 *    |  \--(fraud REVIEW)--> UNDER_REVIEW --(admin approve)--> PROCESSING
 *    \--(fraud BLOCK / balance failed / timeout)--> FAILED
 * </pre>
 */
public enum TransactionStatus {
    PENDING,
    UNDER_REVIEW,
    PROCESSING,
    COMPLETED,
    FAILED;

    public boolean isTerminal() {
        return this == COMPLETED || this == FAILED;
    }
}

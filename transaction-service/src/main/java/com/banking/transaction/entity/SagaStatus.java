package com.banking.transaction.entity;

/** What the saga is currently waiting for (or how it ended). */
public enum SagaStatus {
    /** TRANSACTION_INITIATED published, waiting for fraud-service. */
    AWAITING_FRAUD_CHECK,
    /** Fraud said REVIEW: waiting for an admin decision (never timed out). */
    AWAITING_REVIEW,
    /** BALANCE_UPDATE_REQUESTED published, waiting for account-service. */
    AWAITING_BALANCE_UPDATE,
    COMPLETED,
    FAILED
}

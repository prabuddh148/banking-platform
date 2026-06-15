package com.banking.transaction.entity;

public enum TransactionStatus {
    PENDING,
    PROCESSING,
    FRAUD_CHECK,
    COMPLETED,
    FAILED,
    REVERSED,
    CANCELLED
}

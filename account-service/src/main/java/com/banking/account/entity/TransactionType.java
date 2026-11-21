package com.banking.account.entity;

/**
 * Kind of money movement requested by transaction-service.
 * DEPOSIT credits the destination, WITHDRAWAL debits the source, TRANSFER does both.
 */
public enum TransactionType {
    DEPOSIT,
    WITHDRAWAL,
    TRANSFER
}

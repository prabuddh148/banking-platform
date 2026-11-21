package com.banking.transaction.entity;

/** The three kinds of money movement this service handles. */
public enum TransactionType {
    /** Money comes in from outside: only a destination account. */
    DEPOSIT,
    /** Money goes out: only a source account. */
    WITHDRAWAL,
    /** Money moves between two accounts. */
    TRANSFER
}

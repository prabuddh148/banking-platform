package com.banking.account.entity;

/**
 * Lifecycle of an account.
 * ACTIVE  - normal; money can move in and out.
 * FROZEN  - temporarily blocked by an admin (no debits or credits).
 * CLOSED  - permanently closed; final state.
 */
public enum AccountStatus {
    ACTIVE,
    FROZEN,
    CLOSED
}

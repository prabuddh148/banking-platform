package com.banking.account.entity;

/**
 * Result of processing one BALANCE_UPDATE_REQUESTED event.
 */
public enum BalanceUpdateOutcome {
    /** Balances were changed and BALANCE_UPDATED was emitted. */
    SUCCEEDED,
    /** Business rule failed (no balance change) and BALANCE_UPDATE_FAILED was emitted. */
    FAILED
}

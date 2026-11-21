package com.banking.fraud.entity;

/**
 * What should happen to a transaction after the fraud check.
 * LOW/MEDIUM risk = APPROVE, HIGH = REVIEW (an admin decides), CRITICAL = BLOCK.
 */
public enum Decision {
    APPROVE,
    REVIEW,
    BLOCK
}

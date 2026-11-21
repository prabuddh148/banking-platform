package com.banking.account.entity;

/**
 * State of a row in the outbox table.
 * PENDING   - waiting for the relay to send it to Kafka.
 * PUBLISHED - successfully sent.
 * FAILED    - gave up after too many attempts (needs manual attention).
 */
public enum OutboxStatus {
    PENDING,
    PUBLISHED,
    FAILED
}

package com.banking.transaction.entity;

/** Delivery state of an outbox row. */
public enum OutboxStatus {
    /** Saved, not yet sent to Kafka. */
    PENDING,
    /** Sent to Kafka successfully. */
    PUBLISHED,
    /** Gave up after too many failed attempts. */
    FAILED
}

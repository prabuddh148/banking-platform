package com.banking.transaction.entity;

public enum OutboxStatus {
    PENDING,
    PUBLISHED,
    FAILED
}

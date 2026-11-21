package com.banking.fraud.entity;

/**
 * Lifecycle of a fraud alert: OPEN until an admin reviews it, then APPROVED or REJECTED.
 * Alerts for automatically blocked transactions start as REJECTED (nothing left to decide).
 */
public enum AlertStatus {
    OPEN,
    APPROVED,
    REJECTED
}

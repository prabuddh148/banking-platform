package com.banking.fraud.entity;

/**
 * How risky a transaction looks, derived from its 0-100 risk score
 * (default boundaries: &lt;30 LOW, &lt;60 MEDIUM, &lt;80 HIGH, else CRITICAL).
 */
public enum RiskLevel {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
}

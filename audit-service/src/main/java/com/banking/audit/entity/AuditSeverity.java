package com.banking.audit.entity;

/**
 * How important an audit entry is.
 * <ul>
 *   <li>INFO - normal business activity (account created, transaction completed, ...).</li>
 *   <li>WARNING - something an admin may want to look at (failed transaction, account frozen,
 *       fraud alert waiting for review).</li>
 *   <li>CRITICAL - a transaction was blocked as fraud.</li>
 * </ul>
 */
public enum AuditSeverity {
    INFO,
    WARNING,
    CRITICAL
}

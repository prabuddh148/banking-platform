package com.banking.common.exception;

import org.springframework.http.HttpStatus;
import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Every error the platform can return, grouped by area.
 * Each code carries the HTTP status to send and a default message.
 */
@Getter
@RequiredArgsConstructor
public enum ErrorCode {

    // Generic
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "Internal server error"),
    BAD_REQUEST(HttpStatus.BAD_REQUEST, "Bad request"),
    VALIDATION_ERROR(HttpStatus.BAD_REQUEST, "Request validation failed"),
    NOT_FOUND(HttpStatus.NOT_FOUND, "Resource not found"),
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "Authentication required"),
    FORBIDDEN(HttpStatus.FORBIDDEN, "You are not allowed to perform this action"),
    CONFLICT(HttpStatus.CONFLICT, "Request conflicts with current state"),

    // Account
    ACCOUNT_NOT_FOUND(HttpStatus.NOT_FOUND, "Account not found"),
    ACCOUNT_FROZEN(HttpStatus.CONFLICT, "Account is frozen"),
    ACCOUNT_CLOSED(HttpStatus.CONFLICT, "Account is closed"),
    INSUFFICIENT_FUNDS(HttpStatus.CONFLICT, "Insufficient funds"),
    CURRENCY_MISMATCH(HttpStatus.BAD_REQUEST, "Currency does not match the account currency"),

    // Transaction
    TRANSACTION_NOT_FOUND(HttpStatus.NOT_FOUND, "Transaction not found"),
    TRANSACTION_FAILED(HttpStatus.UNPROCESSABLE_ENTITY, "Transaction failed"),
    INVALID_TRANSACTION(HttpStatus.BAD_REQUEST, "Invalid transaction"),
    DUPLICATE_TRANSACTION(HttpStatus.CONFLICT, "Duplicate transaction"),

    // Fraud
    FRAUD_BLOCKED(HttpStatus.FORBIDDEN, "Transaction blocked by fraud checks"),
    FRAUD_ALERT_NOT_FOUND(HttpStatus.NOT_FOUND, "Fraud alert not found"),

    // Notification
    NOTIFICATION_NOT_FOUND(HttpStatus.NOT_FOUND, "Notification not found"),
    NOTIFICATION_DELIVERY_FAILED(HttpStatus.BAD_GATEWAY, "Notification delivery failed"),

    // Audit
    AUDIT_LOG_NOT_FOUND(HttpStatus.NOT_FOUND, "Audit log not found"),

    // Gateway / auth
    INVALID_TOKEN(HttpStatus.UNAUTHORIZED, "Invalid authentication token"),
    TOKEN_EXPIRED(HttpStatus.UNAUTHORIZED, "Authentication token has expired"),
    INVALID_CREDENTIALS(HttpStatus.UNAUTHORIZED, "Invalid username or password"),
    SERVICE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "Service temporarily unavailable");

    private final HttpStatus status;
    private final String message;
}

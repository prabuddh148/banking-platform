package com.banking.common.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public enum ErrorCode {

    // Generic
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR),
    VALIDATION_ERROR(HttpStatus.BAD_REQUEST),
    RESOURCE_NOT_FOUND(HttpStatus.NOT_FOUND),
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED),
    FORBIDDEN(HttpStatus.FORBIDDEN),

    // Account
    ACCOUNT_NOT_FOUND(HttpStatus.NOT_FOUND),
    ACCOUNT_FROZEN(HttpStatus.CONFLICT),
    ACCOUNT_CLOSED(HttpStatus.CONFLICT),
    DUPLICATE_ACCOUNT(HttpStatus.CONFLICT),
    INSUFFICIENT_FUNDS(HttpStatus.CONFLICT),

    // Transaction
    TRANSACTION_NOT_FOUND(HttpStatus.NOT_FOUND),
    TRANSACTION_FAILED(HttpStatus.UNPROCESSABLE_ENTITY),
    DUPLICATE_TRANSACTION(HttpStatus.CONFLICT),
    LIMIT_EXCEEDED(HttpStatus.CONFLICT),

    // Fraud
    FRAUD_ALERT_NOT_FOUND(HttpStatus.NOT_FOUND),
    FRAUD_BLOCKED(HttpStatus.FORBIDDEN),

    // Notification
    NOTIFICATION_DELIVERY_FAILED(HttpStatus.BAD_GATEWAY),

    // Gateway
    SERVICE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE);

    private final HttpStatus status;

    ErrorCode(HttpStatus status) {
        this.status = status;
    }
}

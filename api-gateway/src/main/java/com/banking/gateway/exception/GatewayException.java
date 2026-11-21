package com.banking.gateway.exception;

import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;

/**
 * Error raised by the gateway itself (bad credentials, missing token, not an admin, ...).
 * The {@link GlobalExceptionHandler} turns it into an {@code ApiResponse} with the code's HTTP status.
 */
public class GatewayException extends BankingException {

    public GatewayException(ErrorCode errorCode) {
        super(errorCode);
    }

    public GatewayException(ErrorCode errorCode, String message) {
        super(errorCode, message);
    }

    public GatewayException(ErrorCode errorCode, String message, Throwable cause) {
        super(errorCode, message, cause);
    }
}

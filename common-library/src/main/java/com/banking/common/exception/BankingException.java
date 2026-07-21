package com.banking.common.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public class BankingException extends RuntimeException {

    private final ErrorCode errorCode;

    public BankingException(ErrorCode errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }

    public BankingException(ErrorCode errorCode, String message, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
    }

    public BankingException(String message) {
        this(ErrorCode.INTERNAL_ERROR, message);
    }

    public HttpStatus getStatus() {
        return errorCode.getStatus();
    }
}

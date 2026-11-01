package com.banking.common.dto;

import com.banking.common.exception.ErrorCode;
import lombok.Getter;

@Getter
public class ErrorResponse {
    private final String message;
    private final String code;
    private final int status;

    public ErrorResponse(ErrorCode errorCode, String message) {
        this.message = message;
        this.code = errorCode.name();
        this.status = errorCode.getStatus().value();
    }

    public ErrorResponse(ErrorCode errorCode) {
        this(errorCode, errorCode.getMessage());
    }
}

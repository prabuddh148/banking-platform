package com.banking.common.dto;

import com.banking.common.exception.ErrorCode;
import lombok.Getter;

public class ErrorResponse {

    @Getter
    private final String message;

    @Getter
    private final String code; 

    @Getter
    private final int status;

    public ErrorResponse(ErrorCode errorCode, String message) {
        this.code = errorCode.name();
        this.message = message;
        this.status = errorCode.getStatus().value();
    }
    
}

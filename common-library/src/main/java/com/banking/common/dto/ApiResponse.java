package com.banking.common.dto;

import com.banking.common.exception.ErrorCode;
import lombok.Getter;   


@Getter
public class ApiResponse<T> {
    private final T data;
    private final ErrorResponse error;

    public ApiResponse(T data) {
        this.data = data;
        this.error = null;
    }

    public ApiResponse(ErrorCode errorCode, String message) {
        this.data = null;
        this.error = new ErrorResponse(errorCode, message);
    }

    public ApiResponse(ErrorCode errorCode) {
        this.data = null;
        this.error = new ErrorResponse(errorCode);
    }
}
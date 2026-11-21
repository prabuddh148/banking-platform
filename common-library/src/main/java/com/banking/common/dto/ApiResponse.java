package com.banking.common.dto;

import com.banking.common.exception.ErrorCode;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Getter;

import java.util.Map;

/**
 * Wrapper for every REST response: either {@code data} or {@code error} is set, never both.
 */
@Getter
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ApiResponse<T> {
    private final T data;
    private final ErrorResponse error;

    public ApiResponse(T data) {
        this.data = data;
        this.error = null;
    }

    public ApiResponse(ErrorResponse error) {
        this.data = null;
        this.error = error;
    }

    public ApiResponse(ErrorCode errorCode, String message) {
        this(new ErrorResponse(errorCode, message));
    }

    public ApiResponse(ErrorCode errorCode) {
        this(new ErrorResponse(errorCode));
    }

    public static <T> ApiResponse<T> success(T data) {
        return new ApiResponse<>(data);
    }

    public static <T> ApiResponse<T> error(ErrorCode errorCode, String message) {
        return new ApiResponse<>(errorCode, message);
    }

    public static <T> ApiResponse<T> error(ErrorCode errorCode, String message, Map<String, String> details) {
        return new ApiResponse<>(new ErrorResponse(errorCode, message, details));
    }

    public boolean isSuccess() {
        return error == null;
    }
}

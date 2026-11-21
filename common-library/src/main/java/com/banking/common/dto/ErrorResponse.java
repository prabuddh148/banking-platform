package com.banking.common.dto;

import com.banking.common.exception.ErrorCode;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Getter;

import java.time.Instant;
import java.util.Map;

/**
 * The "error" part of an API response.
 * {@code details} is only filled for validation errors (field name -> problem).
 */
@Getter
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ErrorResponse {
    private final String message;
    private final String code;
    private final int status;
    private final Map<String, String> details;
    private final Instant timestamp;

    public ErrorResponse(ErrorCode errorCode, String message, Map<String, String> details) {
        this.message = message;
        this.code = errorCode.name();
        this.status = errorCode.getStatus().value();
        this.details = (details == null || details.isEmpty()) ? null : Map.copyOf(details);
        this.timestamp = Instant.now();
    }

    public ErrorResponse(ErrorCode errorCode, String message) {
        this(errorCode, message, null);
    }

    public ErrorResponse(ErrorCode errorCode) {
        this(errorCode, errorCode.getMessage());
    }
}

package com.banking.common.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Getter;

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
}

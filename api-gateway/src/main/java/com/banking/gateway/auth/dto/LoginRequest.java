package com.banking.gateway.auth.dto;

import jakarta.validation.constraints.NotBlank;

/** Body of {@code POST /api/v1/auth/login}. */
public record LoginRequest(
        @NotBlank(message = "username is required") String username,
        @NotBlank(message = "password is required") String password) {
}

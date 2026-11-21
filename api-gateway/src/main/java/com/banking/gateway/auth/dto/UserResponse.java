package com.banking.gateway.auth.dto;

import com.banking.common.security.AuthenticatedUser;

import java.util.List;

/** The logged-in user as returned by login and {@code GET /api/v1/auth/me}. */
public record UserResponse(String userId, String username, String name, String email, List<String> roles) {

    public static UserResponse from(AuthenticatedUser user) {
        return new UserResponse(user.userId(), user.username(), user.name(), user.email(), user.roles());
    }
}

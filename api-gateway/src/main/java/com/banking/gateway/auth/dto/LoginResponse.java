package com.banking.gateway.auth.dto;

/**
 * Result of a successful login.
 *
 * @param accessToken the JWT to send as {@code Authorization: Bearer <accessToken>}
 * @param tokenType   always "Bearer"
 * @param expiresIn   token lifetime in seconds
 * @param user        who logged in
 */
public record LoginResponse(String accessToken, String tokenType, long expiresIn, UserResponse user) {
}

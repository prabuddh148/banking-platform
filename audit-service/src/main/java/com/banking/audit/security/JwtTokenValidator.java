package com.banking.audit.security;

import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.JwtUtil;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * Spring bean wrapper around the shared {@link JwtUtil}.
 * Validates tokens with the same secret the api-gateway uses to sign them.
 */
@Component
public class JwtTokenValidator {

    private final JwtUtil jwtUtil;

    public JwtTokenValidator(
            @Value("${jwt.secret:change-me-dev-secret-key-at-least-32-bytes-long}") String secret,
            @Value("${jwt.expiry:PT1H}") Duration expiry) {
        this.jwtUtil = new JwtUtil(secret, expiry);
    }

    /**
     * @throws com.banking.common.exception.BankingException INVALID_TOKEN or TOKEN_EXPIRED
     */
    public AuthenticatedUser validate(String token) {
        return jwtUtil.parseToken(token);
    }
}

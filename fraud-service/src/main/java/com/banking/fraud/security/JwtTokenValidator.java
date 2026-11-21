package com.banking.fraud.security;

import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.JwtUtil;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * Spring bean around the shared {@link JwtUtil}: validates tokens with the secret from {@code jwt.secret}.
 * The gateway already checked the token; we check again (defense in depth).
 */
@Component
public class JwtTokenValidator {

    private final JwtUtil jwtUtil;

    public JwtTokenValidator(@Value("${jwt.secret}") String secret,
                             @Value("${jwt.expiry:PT1H}") Duration expiry) {
        this.jwtUtil = new JwtUtil(secret, expiry);
    }

    /** @throws com.banking.common.exception.BankingException INVALID_TOKEN or TOKEN_EXPIRED */
    public AuthenticatedUser validate(String token) {
        return jwtUtil.parseToken(token);
    }
}

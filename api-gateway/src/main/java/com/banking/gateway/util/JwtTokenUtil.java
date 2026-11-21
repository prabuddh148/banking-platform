package com.banking.gateway.util;

import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.JwtUtil;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * Spring bean around the shared {@link JwtUtil}, configured from {@code jwt.secret} and
 * {@code jwt.expiry}. The gateway both issues tokens (login) and validates them (every request);
 * the services use the same secret, so they can validate the same tokens.
 */
@Component
public class JwtTokenUtil {

    private final JwtUtil jwtUtil;

    public JwtTokenUtil(@Value("${jwt.secret}") String secret,
                        @Value("${jwt.expiry:PT1H}") Duration expiry) {
        this.jwtUtil = new JwtUtil(secret, expiry);
    }

    public String generateToken(AuthenticatedUser user) {
        return jwtUtil.generateToken(user);
    }

    /**
     * Checks signature, issuer and expiry.
     *
     * @throws com.banking.common.exception.BankingException INVALID_TOKEN or TOKEN_EXPIRED
     */
    public AuthenticatedUser validateToken(String token) {
        return jwtUtil.parseToken(token);
    }

    public Duration getExpiry() {
        return jwtUtil.getExpiry();
    }
}

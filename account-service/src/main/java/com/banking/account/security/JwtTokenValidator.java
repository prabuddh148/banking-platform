package com.banking.account.security;

import com.banking.common.exception.BankingException;
import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.JwtUtil;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * Spring bean around the shared {@link JwtUtil}. The secret must be the same one the
 * api-gateway uses to sign tokens; we re-validate every token here (defense in depth).
 */
@Component
public class JwtTokenValidator {

    private final JwtUtil jwtUtil;

    public JwtTokenValidator(@Value("${jwt.secret}") String secret,
                             @Value("${jwt.expiry:PT1H}") Duration expiry) {
        this.jwtUtil = new JwtUtil(secret, expiry);
    }

    /**
     * @return the user stored in the token
     * @throws BankingException INVALID_TOKEN or TOKEN_EXPIRED
     */
    public AuthenticatedUser validate(String token) {
        return jwtUtil.parseToken(token);
    }
}

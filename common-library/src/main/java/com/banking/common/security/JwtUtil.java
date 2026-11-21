package com.banking.common.security;

import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;

/**
 * Creates and validates HS256-signed JWTs. Plain Java (not a Spring bean) so both the
 * reactive gateway and the servlet services can use it; each service wraps it in its own bean.
 */
public class JwtUtil {

    private final SecretKey key;
    private final Duration expiry;

    /**
     * @param secret at least 32 characters (256 bits) for HS256
     * @param expiry how long issued tokens stay valid
     */
    public JwtUtil(String secret, Duration expiry) {
        if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalArgumentException("JWT secret must be at least 32 bytes long");
        }
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expiry = expiry;
    }

    public String generateToken(AuthenticatedUser user) {
        Instant now = Instant.now();
        return Jwts.builder()
                .id(UUID.randomUUID().toString())
                .issuer(SecurityConstants.ISSUER)
                .subject(user.username())
                .claim(SecurityConstants.CLAIM_USER_ID, user.userId())
                .claim(SecurityConstants.CLAIM_ROLES, user.roles())
                .claim(SecurityConstants.CLAIM_EMAIL, user.email())
                .claim(SecurityConstants.CLAIM_NAME, user.name())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(expiry)))
                .signWith(key)
                .compact();
    }

    /**
     * Validates signature, issuer and expiry and returns the user.
     *
     * @throws BankingException with TOKEN_EXPIRED or INVALID_TOKEN
     */
    public AuthenticatedUser parseToken(String token) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(key)
                    .requireIssuer(SecurityConstants.ISSUER)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            return new AuthenticatedUser(
                    claims.get(SecurityConstants.CLAIM_USER_ID, String.class),
                    claims.getSubject(),
                    claims.get(SecurityConstants.CLAIM_EMAIL, String.class),
                    claims.get(SecurityConstants.CLAIM_NAME, String.class),
                    readRoles(claims));
        } catch (ExpiredJwtException e) {
            throw new BankingException(ErrorCode.TOKEN_EXPIRED);
        } catch (JwtException | IllegalArgumentException e) {
            throw new BankingException(ErrorCode.INVALID_TOKEN, "Invalid token: " + e.getMessage(), e);
        }
    }

    public boolean isValid(String token) {
        try {
            parseToken(token);
            return true;
        } catch (BankingException e) {
            return false;
        }
    }

    public Duration getExpiry() {
        return expiry;
    }

    /** Strips "Bearer " from an Authorization header value; returns null if it is not a bearer header. */
    public static String extractBearerToken(String authorizationHeader) {
        if (authorizationHeader == null || !authorizationHeader.startsWith(SecurityConstants.BEARER_PREFIX)) {
            return null;
        }
        String token = authorizationHeader.substring(SecurityConstants.BEARER_PREFIX.length()).trim();
        return token.isEmpty() ? null : token;
    }

    private static List<String> readRoles(Claims claims) {
        Object raw = claims.get(SecurityConstants.CLAIM_ROLES);
        if (raw instanceof List<?> list) {
            return list.stream().map(String::valueOf).toList();
        }
        return List.of();
    }
}

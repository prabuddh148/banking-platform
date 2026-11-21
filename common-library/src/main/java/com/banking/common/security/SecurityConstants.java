package com.banking.common.security;

/**
 * Header names, JWT claim names and role names shared by the gateway and all services.
 */
public final class SecurityConstants {

    public static final String AUTHORIZATION_HEADER = "Authorization";
    public static final String BEARER_PREFIX = "Bearer ";

    /** Headers the gateway adds after validating the token. */
    public static final String HEADER_USER_ID = "X-User-Id";
    public static final String HEADER_USER_ROLES = "X-User-Roles";
    public static final String HEADER_TRACE_ID = "X-Trace-Id";
    public static final String HEADER_CLIENT_COUNTRY = "X-Client-Country";
    public static final String HEADER_IDEMPOTENCY_KEY = "Idempotency-Key";

    public static final String CLAIM_USER_ID = "userId";
    public static final String CLAIM_ROLES = "roles";
    public static final String CLAIM_EMAIL = "email";
    public static final String CLAIM_NAME = "name";

    public static final String ROLE_CUSTOMER = "ROLE_CUSTOMER";
    public static final String ROLE_ADMIN = "ROLE_ADMIN";

    public static final String ISSUER = "banking-platform";

    private SecurityConstants() {
    }
}

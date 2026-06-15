# ADR-0005: JWT Authentication at API Gateway

**Status**: Accepted

**Date**: 2024-01-22

**Deciders**: Platform Architecture Team, Security Lead, Backend Engineering Lead

---

## Context

The Banking Platform exposes its functionality through an `api-gateway` service (port 8080) that routes requests to five downstream microservices. All user-facing endpoints require authentication: we must verify the caller's identity and propagate authorization context (user ID, roles) to downstream services without repeating authentication logic in each service.

The system must satisfy these requirements:

- **Stateless horizontal scaling**: The gateway and downstream services must scale out without shared session state creating bottlenecks or single points of failure.
- **Low per-request latency**: Authentication overhead must be sub-millisecond under normal operation. A database round-trip per request is undesirable at scale.
- **Standard format**: Tokens must use a widely supported format compatible with standard Spring Security libraries and familiar to engineers.
- **Revocability**: In the event of account compromise or password change, credentials must be invalidable within a defined time window.
- **Minimal attack surface for downstream services**: Downstream services should receive only the validated user context they need, not raw credentials that could be replayed if a service is compromised.
- **Auditability**: Authentication events (login, token refresh, logout, failed attempts) must be recorded.

Three options were formally evaluated.

---

## Decision

We will use **JWT (JSON Web Tokens) with HS256 (HMAC-SHA256) signing**, validated exclusively at the `api-gateway`. Downstream services do not perform JWT cryptographic validation; they receive pre-validated user context via trusted internal HTTP headers injected by the gateway.

### Token Specification

| Token Type | TTL | Transport | Revocable |
|---|---|---|---|
| Access Token | 15 minutes | `Authorization: Bearer {token}` header | No (wait for TTL, or add to blocklist) |
| Refresh Token | 7 days | `HttpOnly; Secure; SameSite=Strict` cookie | Yes — server-side blocklist in `account_db` |

### Validation Flow

```
Client Request (HTTPS)
       │
       ▼
  API Gateway (port 8080)
  ┌────────────────────────────────────────────────┐
  │ 1. Extract Bearer token from Authorization     │
  │ 2. Verify HS256 signature with JWT_SECRET      │
  │ 3. Validate: exp, iat, nbf, iss claims         │
  │ 4. (Token refresh only) Check blocklist in DB  │
  └────────────────────────────────────────────────┘
          │                        │
       VALID                   INVALID
          │                        │
          ▼                        ▼
  Strip Authorization         401 Unauthorized
  Inject X-User-Id            Do NOT forward request
  Inject X-User-Roles
  Inject X-Request-Id
  Forward to downstream
```

### Internal Header Contract

The gateway injects these headers on every authenticated request. The gateway also **strips** any client-supplied versions of these headers before processing, preventing header-injection attacks:

| Header | Example Value | Description |
|---|---|---|
| `X-User-Id` | `usr_01HV3KZQM4XVYP0` | Unique user identifier (ULID format) |
| `X-User-Roles` | `ROLE_CUSTOMER,ROLE_PREMIUM` | Comma-separated Spring Security roles |
| `X-Request-Id` | `req_01HV3KZQM4XVY001` | Trace correlation ID (injected by gateway if absent) |
| `X-Gateway-Validated` | `true` | Sentinel header; downstream services reject requests missing this |

### JWT Claims Structure

```json
{
  "iss": "banking-platform",
  "sub": "usr_01HV3KZQM4XVYP0",
  "iat": 1705312200,
  "exp": 1705313100,
  "nbf": 1705312200,
  "roles": ["ROLE_CUSTOMER"],
  "jti": "jwt_01HV3KZQM4XVY001"
}
```

The `jti` (JWT ID) claim enables selective revocation: when a session is invalidated, all `jti` values issued within that session can be added to the blocklist without invalidating tokens from other sessions.

### Secret Management

- `JWT_SECRET` is a minimum 256-bit (32 random bytes, base64-encoded) secret generated with `openssl rand -base64 32`.
- The secret is never stored in source code, `application.properties`, or Docker images.
- Production: sourced from AWS Secrets Manager, injected as environment variable at container startup.
- Rotation: every 30 days. See `infrastructure/security/policies/secret-rotation-policy.md` for the rotation procedure (includes 24-hour dual-key window to prevent service interruption during rotation).

---

## Consequences

### Positive

- **Stateless validation**: The gateway validates JWTs using only the in-memory `JWT_SECRET`. No database round-trip is required per request. The gateway scales horizontally without a shared session store. Measured HS256 validation overhead: < 0.5ms p99 in load testing.

- **Single validation point**: JWT validation logic lives in one place (`api-gateway`). Downstream services trust the gateway's headers without needing their own cryptographic validation code. This reduces the security surface area across the codebase and simplifies service development — new services get authenticated user context for free.

- **No credential exposure to downstream services**: The raw JWT is stripped by the gateway before forwarding. Downstream services never see the user's credentials, only pre-validated user context headers. A compromised downstream service cannot replay the user's access token to make authenticated requests to the gateway.

- **Standard format**: JWTs are supported natively by Spring Security (`spring-boot-starter-oauth2-resource-server`). Standard libraries handle parsing, validation, and claim extraction without bespoke code.

- **Auditable authentication events**: Token issuance, refresh, and revocation are logged to the audit topic. The `jti` claim links audit events to specific token instances.

### Negative

- **Access token revocation lag**: Access tokens cannot be individually revoked before their TTL expires (15 minutes maximum). If a user's account is compromised and they change their password, an attacker's existing access token remains valid for up to 15 minutes. Mitigation: the 15-minute TTL is deliberately short to bound this window.

- **Symmetric secret risk**: HS256 uses a single shared secret for both signing and verification. If `JWT_SECRET` is leaked, an attacker can forge arbitrary tokens with any `sub` (user ID) and `roles`. This is the most serious risk of this approach. Mitigations: the secret is never in code, stored only in Secrets Manager, rotated every 30 days, and the gateway is the only process that holds it.

- **Blocklist database dependency for refresh tokens**: Refresh token revocation requires a database lookup against the `account_db` blocklist table during the token refresh flow. This adds latency to the refresh operation (not to normal authenticated requests, which do not hit the blocklist). The blocklist table requires periodic pruning of expired entries.

- **No per-service authorization re-verification**: Downstream services cannot cryptographically verify tokens independently. They must trust the gateway completely. If the gateway is bypassed via direct internal network access, there is no second authentication layer. Mitigation: internal services are on a private subnet with no public exposure; network-level controls prevent direct bypass.

### Neutral

- Downstream services must source user context exclusively from the `X-User-Id` and `X-User-Roles` headers and must not accept user identity claims from the request body or query parameters. This is an enforced convention to be checked in code review.

---

## Mitigation Measures

| Risk | Mitigation | Status |
|---|---|---|
| Access token revocation lag | 15-minute TTL limits maximum exposure window | Implemented |
| Symmetric secret breach | Secret rotation every 30 days; AWS Secrets Manager storage | Implemented |
| Secret in logs | `JWT_SECRET` excluded from Spring Boot actuator `/env` endpoint; masked in log configuration | Implemented |
| Blocklist staleness | Scheduled job prunes expired entries from `refresh_token_blocklist` weekly | Implemented |
| Gateway bypass | Internal services on private subnet; `X-Gateway-Validated` header checked by downstream services | Implemented |
| RS256 upgrade path | ADR-0005 explicitly defers RS256 for future service-to-service auth; Spring Security config is designed for drop-in key upgrade | Deferred |

---

## Alternatives Considered

### Alternative A: Session Cookies with Server-Side Sessions (Redis)

Store server-side sessions in Redis. The gateway looks up the session on every request. Spring Session with Redis provides the implementation. Sessions are fully revocable at any time.

**Rejected because**:
- **Single point of failure**: Redis becomes a critical dependency for all authentication. A Redis outage takes down authentication for all services simultaneously — unacceptable for a banking platform.
- **Shared stateful dependency**: All gateway instances must connect to the same Redis cluster. Horizontal scaling of the gateway requires the Redis session store to also be highly available, introducing operational complexity and latency.
- **Not cloud-native friendly**: This architecture requires a stateful shared component in what should be a stateless, horizontally scalable tier.
- **Not permanently rejected**: If the 15-minute revocation window proves unacceptable for compliance or security requirements, a Redis-backed access token blocklist (not full sessions) may be added as a supplementary control. This would require a new ADR.

### Alternative B: Opaque Tokens with Token Introspection Endpoint (OAuth 2.0 RFC 7662)

Issue random opaque tokens. The gateway (or each service) calls a central introspection endpoint to validate tokens on every request. Tokens are fully revocable instantly.

**Rejected because**:
- **Per-request network latency**: Every authenticated request adds a network round-trip to the introspection service. At 500 req/s gateway throughput, this adds ~5ms per request and ~2500 introspection calls/second, creating a critical bottleneck.
- **New high-availability critical service**: The introspection endpoint becomes a zero-downtime-required component with zero tolerance for degradation. Its availability directly determines whether any user can authenticate.
- **Disproportionate complexity**: Building and operating a standards-compliant OAuth 2.0 authorization server (or purchasing one) is significantly more complex than a JWT-validating gateway filter.

### Alternative C: RS256 Asymmetric JWT (Deferred, Not Rejected)

Use RS256 (RSA-2048 or EC P-256) instead of HS256. The gateway signs tokens with a private key. Downstream services verify tokens using the corresponding public key fetched from a JWKS endpoint, without sharing any secret.

**Not rejected — deferred to future ADR**:
- RS256 allows each service to independently verify tokens using only the public key, removing the complete trust dependency on the gateway for internal service-to-service calls.
- RS256 requires key pair management, a JWKS endpoint, and key rotation procedures that are more complex than HS256 secret rotation.
- **Recommended future upgrade trigger**: When the platform adds service-to-service authenticated calls with user context propagation (e.g., `transaction-service` calling `account-service` on behalf of a user), HS256 requires gateway mediation for every hop. RS256 with a JWKS endpoint eliminates this constraint. This upgrade should be evaluated when implementing an internal service mesh.

---

## References

- [RFC 7519 — JSON Web Token (JWT)](https://datatracker.ietf.org/doc/html/rfc7519)
- [RFC 7662 — OAuth 2.0 Token Introspection](https://datatracker.ietf.org/doc/html/rfc7662)
- [OWASP JWT Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
- [Spring Security — OAuth2 Resource Server (JWT)](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html)
- Secret rotation procedure: `infrastructure/security/policies/secret-rotation-policy.md`
- Related: ADR-0006 (Async Fraud Detection) — relies on X-User-Id header propagated by this mechanism

# Security Model

Decision record: [ADR 0005](../adr/0005-jwt-authentication.md).

## 1. Overview

```
Browser ──HTTPS──► api-gateway ──► service ──► own database
          JWT       validates JWT    validates JWT again
                    adds X-User-Id,  builds SecurityContext
                    X-User-Roles,    checks role + ownership
                    X-Trace-Id
```

- **Authentication**: JWT bearer tokens issued by the gateway.
- **Authorization**: role-based (`ROLE_CUSTOMER`, `ROLE_ADMIN`) + ownership checks in every service.
- **Defense in depth**: each service validates the token itself; internal headers are never trusted alone.
- **Stateless**: no HTTP sessions, CSRF disabled (no cookies are used for auth).

## 2. Authentication

### Login

`POST /api/v1/auth/login` with `{"username": "...", "password": "..."}` on the gateway.

```json
{
  "data": {
    "accessToken": "eyJhbGciOi...",
    "tokenType": "Bearer",
    "expiresIn": 3600,
    "user": {
      "userId": "CUST-1001",
      "username": "rahul",
      "name": "Rahul Sharma",
      "email": "rahul.sharma@example.com",
      "roles": ["ROLE_CUSTOMER"]
    }
  }
}
```

Wrong credentials → `401 INVALID_CREDENTIALS`. `GET /api/v1/auth/me` returns the current user.

Users come from gateway configuration (`gateway.auth.users`), with BCrypt or (demo only) plain
passwords. Demo users:

| Username | Password | User id | Roles |
|----------|----------|---------|-------|
| rahul | password | CUST-1001 | ROLE_CUSTOMER |
| priya | password | CUST-1002 | ROLE_CUSTOMER |
| admin | admin123 | ADMIN-1 | ROLE_ADMIN, ROLE_CUSTOMER |

### Token

- Signed with HMAC-SHA using `JWT_SECRET` (≥ 32 bytes), via `common-library` `JwtUtil`.
- Lifetime `JWT_EXPIRY` (default `PT1H`).
- Claims: issuer, subject (username), `userId`, `roles`, `email`, `name`, issued-at, expiry. The issuer is checked on validation too.
- Errors: `401 INVALID_TOKEN` (bad signature / malformed) and `401 TOKEN_EXPIRED`.

### Validation path

1. Gateway `JwtAuthenticationFilter` validates every request except `/api/v1/auth/login` and
   `/actuator/**`. Invalid → 401 JSON. Valid → forwards `Authorization` and adds `X-User-Id`,
   `X-User-Roles`, `X-Trace-Id`.
2. Service `JwtAuthenticationFilter` (`OncePerRequestFilter`) reads `Authorization: Bearer ...`,
   parses with `JwtTokenValidator`, and puts a `UsernamePasswordAuthenticationToken(AuthenticatedUser,
   null, roles)` into the `SecurityContext`.
   - Invalid token → 401 `ApiResponse.error(INVALID_TOKEN | TOKEN_EXPIRED)`.
   - No token → request continues anonymous → 401 from the authentication entry point.
3. `SecurityConfig`: stateless, CSRF off, `@EnableMethodSecurity`; public: `/actuator/health/**`,
   `/actuator/info`, `/actuator/prometheus`; everything else authenticated. 401/403 are JSON
   `ApiResponse` bodies.

## 3. Authorization

### Roles

| Capability | Customer | Admin |
|------------|----------|-------|
| Open account for self | ✓ | ✓ (any `customerId`) |
| View / update own accounts | ✓ | ✓ (all) |
| Freeze / unfreeze account | | ✓ |
| Close account (balance 0) | own | ✓ |
| Reserve / release funds | | ✓ |
| Deposit / withdraw / transfer from own accounts | ✓ | ✓ |
| View own transactions | ✓ | ✓ (all, with filters) |
| View saga state | | ✓ |
| Fraud alerts, review, stats, dry-run check | | ✓ |
| Fraud decision by transaction | ✓ | ✓ |
| Own notifications, mark as read | ✓ | ✓ |
| Retry notification | | ✓ |
| Audit logs and summary | | ✓ |
| System health (`/api/v1/system/health`) | | ✓ |

Admin endpoints use `@PreAuthorize("hasRole('ADMIN')")`.

### Ownership

`CurrentUser.requireOwnerOrAdmin(ownerId)` (common-library) throws `403 FORBIDDEN` unless the caller
owns the resource or is an admin. Examples:
- account-service: `account.customerId == userId`.
- transaction-service: `transaction.initiatedBy == userId`.
- notification-service: `notification.recipientId == userId`.

Ownership is also enforced **inside the saga**: account-service checks that the source account of a
TRANSFER/WITHDRAWAL belongs to `initiatedBy` from the event, and fails the balance update with
`FORBIDDEN` otherwise. So even a bug in transaction-service cannot move money out of someone else's
account.

## 4. Data protection

- PII in logs and audit details is masked with `MaskingUtil` (emails, phone numbers, account numbers).
- Notification API returns the `recipient` masked.
- Audit logs are immutable (DB triggers block UPDATE/DELETE/TRUNCATE).
- Money is `BigDecimal` (scale 2, HALF_EVEN) — no floating-point errors.
- Validation at the edge: `@Valid` DTOs, `@ValidCurrency` (INR, USD, EUR, GBP), amount limits
  (> 0, ≤ 10,000,000).

## 5. Transport and network

- Local: plain HTTP on localhost.
- Production: TLS at the edge (load balancer → gateway); service ports not exposed publicly; mTLS or
  a private network between gateway, services, Postgres and Kafka; Kafka with SASL/TLS.
- CORS: only `CORS_ALLOWED_ORIGINS` (default `http://localhost:5173`).

## 6. Abuse protection

- Idempotency (`Idempotency-Key` header) prevents accidental double transfers on client retries.
- Fraud rules screen every money movement ([ADR 0006](../adr/0006-fraud-async-design.md)).
- Recommended next steps: login rate limiting and lockout at the gateway (Redis is available),
  request size limits.

## 7. Known limitations

| Limitation | Mitigation / plan |
|------------|-------------------|
| Shared symmetric `JWT_SECRET` | Protect as a secret; move to RS256 + JWKS (OIDC provider) |
| No refresh tokens / revocation | Short expiry (1 h); add refresh + deny-list later |
| Demo users in config | Replace with a real identity provider before any real use |
| Actuator `prometheus` public | Restrict to the internal network in production |

Related: [threat-model](threat-model.md), [secret-management](secret-management.md),
[compliance-notes](compliance-notes.md).

# JWT policy

How the banking platform issues, carries and validates access tokens.
Implementation: `common-library` → `com.banking.common.security.JwtUtil`,
`AuthenticatedUser`, `SecurityConstants`, `CurrentUser`.

## 1. Issuing

- Tokens are issued **only** by the api-gateway: `POST /api/v1/auth/login`
  (`{username, password}` → `{accessToken, tokenType: "Bearer", expiresIn, user}`).
- No other service creates tokens.
- Local demo users come from gateway config (`gateway.auth.users`). They exist for
  development only and must be removed / replaced by a real identity provider
  anywhere outside a laptop.

## 2. Token format

| Item | Value |
|---|---|
| Type | JWS (signed, not encrypted) — **never put secrets or full PII in claims** |
| Algorithm | HMAC-SHA256 (`HS256`), symmetric key `JWT_SECRET` |
| Key length | ≥ 32 bytes (256 bits) of random data. Shorter keys are rejected at startup. |
| `sub` | user id (`CUST-1001`, `ADMIN-1`) |
| Custom claims | username, email, name, roles (`ROLE_CUSTOMER`, `ROLE_ADMIN`) — names in `SecurityConstants` |
| `iat` / `exp` | issued-at and expiry; lifetime = `JWT_EXPIRY` |

## 3. Lifetime

| Environment | `JWT_EXPIRY` |
|---|---|
| local / dev | `PT1H` (default) |
| staging / production | `PT15M` recommended |

- There are no refresh tokens yet; the client logs in again when the token expires
  (HTTP 401 with error code `TOKEN_EXPIRED`).
- Clock skew tolerance: keep server clocks NTP-synced; do not add more than 60 s leeway.

## 4. Transport

- Always `Authorization: Bearer <token>` header. Never in URLs / query strings
  (they end up in logs and browser history).
- TLS everywhere outside the local docker network.
- The frontend keeps the token in memory (or sessionStorage); never in a cookie
  without `HttpOnly; Secure; SameSite=Strict`.

## 5. Validation (defense in depth)

1. **api-gateway** validates the token on every route except `/api/v1/auth/login`
   and `/actuator/**`, then forwards the original `Authorization` header plus
   `X-User-Id`, `X-User-Roles` and `X-Trace-Id`.
2. **Every service validates the token again** (`JwtAuthenticationFilter`) using the
   same `JWT_SECRET`. Services must **not** trust `X-User-*` headers on their own —
   they are informational only, because a service can be reached without the gateway
   (e.g. ports 8081-8085 exposed in docker-compose).
3. Rejected tokens → `401` with `ApiResponse.error(INVALID_TOKEN | TOKEN_EXPIRED)`.
   Missing token on a protected endpoint → `401 UNAUTHORIZED`. Wrong role → `403 FORBIDDEN`.
4. Public endpoints: `/actuator/health/**`, `/actuator/info`, `/actuator/prometheus`
   (in production, restrict `/actuator/prometheus` to the monitoring network).

## 6. Authorization rules

- `ROLE_ADMIN` endpoints use `@PreAuthorize("hasRole('ADMIN')")`.
- Customers may only see their own data: `CurrentUser.requireOwnerOrAdmin(ownerId)`.
- The user id used for ownership checks always comes from the **validated token**,
  never from a request body or header (e.g. `customerId` in `CreateAccountRequest`
  is honoured only for admins).

## 7. Logging

- Never log a full token. If needed, log the last 6 characters or the `sub` claim.
- Log failed validations at `WARN` with the trace id and reason (expired, bad
  signature, malformed) — not the token.

## 8. Revocation

Stateless HS256 tokens cannot be revoked individually. Mitigations:
- short lifetime (15 min in production);
- emergency: rotate `JWT_SECRET` (invalidates **all** tokens — see
  `secret-rotation-policy.md`);
- future: a deny-list of token ids (`jti`) in Redis checked by the gateway.

## 9. Future hardening

- Move to asymmetric keys (RS256 / ES256): only the gateway / IdP holds the private
  key, services verify with the public key (JWKS), so a compromised service cannot
  mint tokens.
- Add `iss` and `aud` claims and validate them.
- Refresh tokens with rotation and reuse detection.

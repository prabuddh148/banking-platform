# 0005. JWT authentication: gateway issues, every service re-validates

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

Clients (the React frontend, curl) talk to one entry point, the api-gateway on port 8080. Behind it
are five services that must know **who** is calling and **which roles** they have, so that customers
only see their own accounts and only admins can freeze accounts or review fraud alerts.

We want stateless services (no shared session store) and we do not want to trust a request just
because it arrived on an internal port.

## Decision

- The **api-gateway issues JWTs** at `POST /api/v1/auth/login` (demo users from
  `gateway.auth.users` config). The response contains `accessToken`, `tokenType: "Bearer"`,
  `expiresIn` (seconds) and the `user` object.
- Tokens are signed with HMAC-SHA (jjwt picks HS256/384/512 from the key length) using a shared secret `JWT_SECRET` (at least 32 bytes) and expire
  after `JWT_EXPIRY` (ISO-8601 duration, default `PT1H`). Claims include the user id, username,
  email, name and roles (`ROLE_CUSTOMER`, `ROLE_ADMIN`). Token code lives in `common-library`
  (`JwtUtil`, `AuthenticatedUser`).
- The **gateway validates** the token for every route except `/api/v1/auth/login` and `/actuator/**`,
  then forwards the `Authorization` header and adds `X-User-Id`, `X-User-Roles` and `X-Trace-Id`.
- **Every service validates the token again** (`JwtAuthenticationFilter` + `JwtTokenValidator`) and
  builds its own Spring Security context. Services do **not** trust `X-User-Id` alone.
- Authorization: `@PreAuthorize("hasRole('ADMIN')")` for admin endpoints, and
  `CurrentUser.requireOwnerOrAdmin(ownerId)` for ownership checks.

## Consequences

**Positive**
- Defense in depth: if someone reaches a service port directly (bypassing the gateway) they still need
  a valid token.
- Stateless and horizontally scalable; no session replication.
- Same code for all services through `common-library`.

**Negative**
- A shared symmetric secret: any service could mint tokens. Secret must be protected
  (see [secret-management](../security/secret-management.md)).
- Tokens cannot be revoked before expiry (no refresh/revocation list yet). Keep expiry short.
- Role changes take effect only on next login.

## Alternatives considered

- **Trust gateway headers only** — simpler, but any internal caller could fake `X-User-Id`. Rejected.
- **OAuth2 / OIDC with Keycloak and RS256** — the right production choice (asymmetric keys, refresh
  tokens, revocation). Planned as a future ADR; too heavy for the current scope.
- **Server sessions + Redis** — stateful, and every service would need the session store.

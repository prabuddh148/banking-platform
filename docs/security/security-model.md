# Security Model

**Platform:** Banking Platform  
**Stack:** Java 21, Spring Boot 3.2.5, Spring Security 6, JJWT 0.12.x  
**Architecture:** API Gateway (Spring Cloud Gateway, reactive) + 5 microservices  
**Last Updated:** 2026-06-15

---

## Table of Contents

1. [Security Layers Overview](#1-security-layers-overview)
2. [JWT Authentication Flow](#2-jwt-authentication-flow)
3. [Token Structure](#3-token-structure)
4. [Token Lifecycle](#4-token-lifecycle)
5. [Role Matrix](#5-role-matrix)
6. [Resource-Level Authorization](#6-resource-level-authorization)
7. [API Gateway Security Filters](#7-api-gateway-security-filters)
8. [Service-to-Service Authentication](#8-service-to-service-authentication)
9. [Security Headers](#9-security-headers)
10. [Session Management](#10-session-management)

---

## 1. Security Layers Overview

The platform applies defense-in-depth through five discrete security layers. Each layer is independently enforced; a failure in one does not collapse the entire security posture.

```
+-------------------------------------------------------------+
|  Layer 1 - Perimeter                                        |
|  TLS 1.2+ termination, DDoS protection, IP allowlisting    |
+-------------------------------------------------------------+
|  Layer 2 - Transport                                        |
|  HTTPS enforced at Gateway, HSTS header, no HTTP fallback  |
+-------------------------------------------------------------+
|  Layer 3 - Authentication (AuthN)                           |
|  JWT validation at Gateway, token expiry, jti uniqueness   |
+-------------------------------------------------------------+
|  Layer 4 - Authorization (AuthZ)                            |
|  Role-based access control, resource ownership checks      |
+-------------------------------------------------------------+
|  Layer 5 - Data                                             |
|  Encrypted at rest (RDS encryption), masked in logs/APIs   |
+-------------------------------------------------------------+
```

### Layer Responsibilities

| Layer | Enforcement Point | Technology |
|---|---|---|
| Perimeter | Load balancer / WAF | AWS ALB, optional WAF |
| Transport | API Gateway | TLS 1.2+, HSTS |
| Authentication | Gateway JwtAuthFilter | JJWT 0.12.x |
| Authorization | Each microservice + Gateway | Spring Security 6, `@PreAuthorize` |
| Data | PostgreSQL + application | AES-256 at rest, MaskingUtil in logs |

---

## 2. JWT Authentication Flow

The complete sequence from unauthenticated client to authorized service response:

```
Client                  API Gateway              Auth Service           Microservice
  |                         |                        |                       |
  |  POST /auth/login        |                        |                       |
  |------------------------>|                        |                       |
  |                         |  Forward /auth/**       |                       |
  |                         |----------------------->|                       |
  |                         |                        |  Validate credentials  |
  |                         |                        |  Generate accessToken  |
  |                         |                        |  Generate refreshToken |
  |                         |<-----------------------|                       |
  |  200 { accessToken,      |                        |                       |
  |        refreshToken }    |                        |                       |
  |<------------------------|                        |                       |
  |                         |                        |                       |
  |  GET /api/accounts       |                        |                       |
  |  Authorization: Bearer   |                        |                       |
  |------------------------>|                        |                       |
  |                         |  JwtAuthFilter (order -1)                      |
  |                         |  1. Extract Bearer token                       |
  |                         |  2. Validate signature (HS256 + secret)        |
  |                         |  3. Check exp claim                            |
  |                         |  4. Check jti not in revocation list           |
  |                         |  5. Populate SecurityContext                   |
  |                         |  6. Propagate X-User-Id, X-User-Roles headers  |
  |                         |----------------------------------------------->|
  |                         |                        |  Service reads headers  |
  |                         |                        |  Applies @PreAuthorize  |
  |                         |                        |  Checks resource owner  |
  |                         |<-----------------------------------------------|
  |<------------------------|                        |                       |
```

### Token Refresh Flow

```
Client                  API Gateway              Auth Service
  |                         |                        |
  |  POST /auth/refresh      |                        |
  |  { refreshToken }        |                        |
  |------------------------>|                        |
  |                         |  Forward to auth-service|
  |                         |----------------------->|
  |                         |                        |  Validate refreshToken
  |                         |                        |  Check refresh token DB
  |                         |                        |  Invalidate old refresh token
  |                         |                        |  Issue new accessToken + refreshToken
  |                         |<-----------------------|
  |  200 { accessToken,      |                        |
  |        refreshToken }    |                        |
  |<------------------------|                        |
```

---

## 3. Token Structure

### 3.1 Access Token

#### Header

```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

#### Payload Claims

```json
{
  "iss": "banking-platform-auth",
  "sub": "usr_a1b2c3d4e5f6",
  "jti": "550e8400-e29b-41d4-a716-446655440000",
  "iat": 1718438400,
  "exp": 1718439300,
  "roles": ["ROLE_CUSTOMER"],
  "customerId": "cust_x9y8z7w6",
  "scope": "api"
}
```

| Claim | Type | Description |
|---|---|---|
| `iss` | String | Issuer — always `banking-platform-auth` |
| `sub` | String | Subject — internal userId (prefixed `usr_`) |
| `jti` | UUID | JWT ID — unique per token; used for revocation checks |
| `iat` | Unix timestamp | Issued at |
| `exp` | Unix timestamp | Expiry — `iat + 900` seconds (15 minutes) |
| `roles` | String array | One or more of the defined ROLE_* values |
| `customerId` | String | Customer identifier for ownership checks (null for staff roles) |
| `scope` | String | `api` for user tokens, `service` for internal service tokens |

#### Signature

```
HMAC-SHA256(
  base64url(header) + "." + base64url(payload),
  JWT_SECRET
)
```

The `JWT_SECRET` is a minimum 256-bit random string stored in secrets management (see `secret-management.md`).

### 3.2 Service-to-Service Token

```json
{
  "iss": "banking-platform-auth",
  "sub": "account-service",
  "jti": "...",
  "iat": 1718438400,
  "exp": 1718438700,
  "scope": "service",
  "serviceId": "account-service"
}
```

Transmitted via the `X-Service-Token` header. Validated by the receiving service independently of the Gateway JWT filter.

---

## 4. Token Lifecycle

| Property | Access Token | Refresh Token |
|---|---|---|
| TTL | 15 minutes | 7 days |
| Storage (client) | Memory / secure cookie | HttpOnly secure cookie or secure storage |
| Storage (server) | None (stateless) | Hashed in `refresh_tokens` DB table |
| Revocation | jti blocklist (Redis, short TTL) | Delete row from `refresh_tokens` table |
| Rotation | Reissued on every `/auth/refresh` call | Rotated on every use (old token invalidated) |
| Algorithm | HS256 | HS256 |
| Payload | Full claims including roles | Minimal: `sub`, `jti`, `exp` |
| Max issuable per user | No hard limit (rate-limited at gateway) | 10 concurrent devices |

### Token Expiry Behavior

- **Expired access token:** Gateway returns `401 Unauthorized` with body `{ "error": "TOKEN_EXPIRED" }`.
- **Expired refresh token:** `/auth/refresh` returns `401` with `{ "error": "REFRESH_TOKEN_EXPIRED" }`. User must re-authenticate.
- **Revoked jti:** Gateway blocklist lookup returns `401` with `{ "error": "TOKEN_REVOKED" }`.

---

## 5. Role Matrix

### 5.1 Defined Roles

| Role | Description | Assigned To |
|---|---|---|
| `ROLE_CUSTOMER` | Standard retail banking customer | End users |
| `ROLE_PREMIUM` | Premium customer with elevated limits | Premium account holders |
| `ROLE_SUPPORT` | Customer support staff — read-only | Internal support team |
| `ROLE_FRAUD_ANALYST` | Fraud review and alert management | Fraud operations team |
| `ROLE_COMPLIANCE` | Audit log access — read-only | Compliance and audit team |
| `ROLE_ADMIN` | Full system access | Platform administrators |

### 5.2 Endpoint Access by Role

| Endpoint Pattern | CUSTOMER | PREMIUM | SUPPORT | FRAUD_ANALYST | COMPLIANCE | ADMIN |
|---|---|---|---|---|---|---|
| `GET /api/accounts/{id}` | Own only | Own only | All (read) | — | — | All |
| `POST /api/accounts` | Yes | Yes | No | No | No | Yes |
| `PUT /api/accounts/{id}` | Own only | Own only | No | No | No | All |
| `DELETE /api/accounts/{id}` | No | No | No | No | No | Yes |
| `GET /api/transactions` | Own only | Own only | All (read) | All (read) | — | All |
| `POST /api/transactions` | Yes (std limits) | Yes (high limits) | No | No | No | Yes |
| `GET /api/transactions/{id}` | Own only | Own only | All (read) | All (read) | — | All |
| `GET /api/fraud/alerts` | No | No | No | Yes | No | Yes |
| `POST /api/fraud/alerts/{id}/review` | No | No | No | Yes | No | Yes |
| `PUT /api/fraud/alerts/{id}/status` | No | No | No | Yes | No | Yes |
| `GET /api/audit/logs` | No | No | No | No | Yes | Yes |
| `GET /api/notifications` | Own only | Own only | No | No | No | Yes |
| `POST /api/admin/**` | No | No | No | No | No | Yes |
| `GET /api/users` | No | No | Yes (read) | No | No | Yes |

### 5.3 Transaction Limits by Role

| Role | Single Transaction Limit | Daily Limit | International Transfers |
|---|---|---|---|
| `ROLE_CUSTOMER` | $10,000 | $25,000 | No |
| `ROLE_PREMIUM` | $100,000 | $250,000 | Yes |
| `ROLE_ADMIN` | Unlimited | Unlimited | Yes |

---

## 6. Resource-Level Authorization

Role checks alone are insufficient. Customers must only access their own resources. This is enforced at the service layer using the `customerId` claim from the JWT.

### Enforcement Pattern

```java
@GetMapping("/accounts/{accountId}")
@PreAuthorize("hasRole('CUSTOMER') or hasRole('ADMIN') or hasRole('SUPPORT')")
public ResponseEntity<AccountDto> getAccount(
        @PathVariable String accountId,
        @AuthenticationPrincipal JwtClaimsPrincipal principal) {

    Account account = accountRepository.findById(accountId)
        .orElseThrow(() -> new ResourceNotFoundException("Account not found"));

    // Resource ownership check -- applied for CUSTOMER and PREMIUM roles
    if (principal.hasRole("ROLE_CUSTOMER") || principal.hasRole("ROLE_PREMIUM")) {
        if (!account.getCustomerId().equals(principal.getCustomerId())) {
            throw new AccessDeniedException("Account does not belong to the requesting customer");
        }
    }

    return ResponseEntity.ok(accountMapper.toDto(account));
}
```

### Claims Propagation

The Gateway extracts JWT claims and forwards them as request headers to downstream services:

| Header | Source Claim | Example Value |
|---|---|---|
| `X-User-Id` | `sub` | `usr_a1b2c3d4e5f6` |
| `X-Customer-Id` | `customerId` | `cust_x9y8z7w6` |
| `X-User-Roles` | `roles` (comma-joined) | `ROLE_CUSTOMER` |
| `X-Correlation-Id` | Generated at gateway | `req_550e8400...` |

Downstream services reconstruct the `SecurityContext` from these headers. They must **never** trust client-supplied headers — the Gateway strips these from inbound requests before adding its own validated values.

---

## 7. API Gateway Security Filters

All filters are registered as `GlobalFilter` beans in the Spring Cloud Gateway application context.

### Filter Chain (Execution Order)

```
Inbound Request
       |
       v
+---------------------------------+  order = -10
|  RequestSizeLimitFilter          |  Reject if body > 5 MB
+---------------------------------+
       |
       v
+---------------------------------+  order = -5
|  CorsFilter                      |  Enforce allowed origins
+---------------------------------+
       |
       v
+---------------------------------+  order = -1
|  JwtAuthFilter                   |  Validate token, populate context
+---------------------------------+
       |
       v
+---------------------------------+  order = 0
|  RateLimitFilter                 |  Token bucket per userId/IP
+---------------------------------+
       |
       v
+---------------------------------+  order = 5
|  TraceIdPropagationFilter        |  Attach X-Correlation-Id
+---------------------------------+
       |
       v
+---------------------------------+  order = 10
|  SecurityHeadersFilter           |  Add response security headers
+---------------------------------+
       |
       v
   Route to Microservice
```

### Filter Details

| Filter | Order | Configuration |
|---|---|---|
| `RequestSizeLimitFilter` | -10 | Max body: 5 MB; returns `413` if exceeded |
| `CorsFilter` | -5 | Allowed origins from config; credentials allowed; max age 3600s |
| `JwtAuthFilter` | -1 | Validates HS256 signature, expiry, issuer, jti; skips `/auth/**` and `/actuator/health` |
| `RateLimitFilter` | 0 | 100 req/min per authenticated userId; 20 req/min per anonymous IP |
| `TraceIdPropagationFilter` | 5 | Generates `X-Correlation-Id` if absent; propagates to all downstream headers |
| `SecurityHeadersFilter` | 10 | Adds HSTS, X-Content-Type-Options, X-Frame-Options, CSP |

### Public Endpoints (No JWT Required)

```
POST /auth/login
POST /auth/register
POST /auth/refresh
GET  /actuator/health
GET  /actuator/info
```

---

## 8. Service-to-Service Authentication

Internal services communicate directly over the private network. Each outbound call from a service includes an `X-Service-Token` header.

### Service Call Matrix

| Caller | Callee | Purpose |
|---|---|---|
| `transaction-service` | `account-service` | Balance reads and updates |
| `transaction-service` | `notification-service` | Transaction confirmation events |
| `fraud-service` | `transaction-service` | Pull transaction history for analysis |
| `fraud-service` | `notification-service` | Fraud alert notifications |
| `account-service` | `notification-service` | Account change notifications |

### Internal Token Generation

Each service holds its own `SERVICE_CLIENT_SECRET` and generates short-lived (5-minute TTL) internal tokens at startup and before each outbound call, rotating proactively at 4 minutes:

```java
// Called by FeignClient interceptor / WebClient filter
public String generateServiceToken(String serviceId) {
    return Jwts.builder()
        .issuer("banking-platform-auth")
        .subject(serviceId)
        .claim("scope", "service")
        .claim("serviceId", serviceId)
        .issuedAt(new Date())
        .expiration(new Date(System.currentTimeMillis() + 300_000))
        .id(UUID.randomUUID().toString())
        .signWith(serviceSigningKey, Jwts.SIG.HS256)
        .compact();
}
```

### Receiving Service Validation

```java
@Component
public class ServiceTokenFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String serviceToken = request.getHeader("X-Service-Token");
        if (serviceToken == null) {
            response.sendError(HttpStatus.UNAUTHORIZED.value(), "Missing service token");
            return;
        }
        Claims claims = jwtService.parseServiceToken(serviceToken);
        if (!"service".equals(claims.get("scope"))) {
            response.sendError(HttpStatus.FORBIDDEN.value(), "Invalid service scope");
            return;
        }
        filterChain.doFilter(request, response);
    }
}
```

---

## 9. Security Headers

All responses from the API Gateway include the following headers.

| Header | Value | Purpose |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Enforce HTTPS for 1 year |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME-type sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `Content-Security-Policy` | `default-src 'self'; frame-ancestors 'none'` | Restrict resource loading |
| `Referrer-Policy` | `no-referrer` | Suppress referrer information |
| `Permissions-Policy` | `geolocation=(), camera=(), microphone=()` | Disable unused browser APIs |
| `Cache-Control` | `no-store` | Prevent caching of sensitive API responses |

---

## 10. Session Management

The platform is fully stateless. There are no server-side HTTP sessions.

### Stateless Design

- `SessionCreationPolicy.STATELESS` is set on every `SecurityFilterChain`.
- No `HttpSession` is created or consulted at any point.
- `SecurityContext` is populated per-request from the validated JWT claims.
- The `SecurityContextHolder` is cleared at the end of each request (default `ThreadLocalSecurityContextHolderStrategy`; cleared in the filter chain's `finally` block).

### SecurityContext Population (Per Request)

```
Inbound Request
       |
       v (JwtAuthFilter)
Extract JWT -> Validate -> Parse Claims
       |
       v
Build UsernamePasswordAuthenticationToken(
    principal = JwtClaimsPrincipal { userId, customerId },
    credentials = null,
    authorities = [SimpleGrantedAuthority("ROLE_CUSTOMER")]
)
       |
       v
SecurityContextHolder.getContext().setAuthentication(token)
       |
       v
Controller / Service executes
       |
       v
SecurityContextHolder.clearContext()  <- always, even on error
```

### Logout

Logout does not require server state. The client discards both tokens. If immediate revocation is needed (e.g., account compromise), the `jti` is added to a Redis-backed blocklist with TTL equal to the remaining token validity period.

```
POST /auth/logout
Authorization: Bearer <accessToken>
Body: { "refreshToken": "..." }

-> Adds accessToken.jti to Redis blocklist (TTL = remaining expiry seconds)
-> Deletes refreshToken row from refresh_tokens table
-> Returns 204 No Content
```

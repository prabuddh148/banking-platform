# Threat Model

**Platform:** Banking Platform  
**Methodology:** STRIDE  
**Architecture:** API Gateway + 5 Microservices + PostgreSQL + Apache Kafka  
**Last Updated:** 2026-06-15  
**Review Cadence:** Annually or after major architecture changes

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Trust Boundaries](#2-trust-boundaries)
3. [Attack Surface Summary](#3-attack-surface-summary)
4. [STRIDE Analysis](#4-stride-analysis)
5. [Top 5 Critical Risks](#5-top-5-critical-risks)
6. [Accepted Risks](#6-accepted-risks)
7. [Security Controls Not Yet Implemented](#7-security-controls-not-yet-implemented)

---

## 1. System Overview

```
                     +---------------------------------------------------+
                     |               INTERNET (Zone 0)                   |
                     +---------------------+-----------------------------+
                                           | HTTPS / TLS 1.2+
                     +---------------------------------------------------+
                     |           API GATEWAY (Zone 1)                    |
                     | Spring Cloud Gateway + JwtAuthFilter + RateLimiter|
                     +---+----------+----------+----------+-----------+--+
                         |          |          |          |           |
                   +-----+--+ +----+---+ +---+----+ +---+----+ +-----+------+
                   |Account | |Transact| | Fraud  | | Notif. | |    Auth    |
                   |Service | |Service | |Service | |Service | |  Service   |
                   +---+----+ +---+----+ +---+----+ +---+----+ +------------+
                       |          |           |          |   (Zone 2 - Private)
           +-----------+----------+-----------+----------+----------------+
           |                 PostgreSQL Databases (Zone 3)               |
           +------------------------------------------------------------+-+
                       |          |
           +-----------+----------+-----------------------------------------+
           |                  Apache Kafka (Zone 4)                         |
           +----------------------------------------------------------------+
```

---

## 2. Trust Boundaries

| Boundary | From Zone | To Zone | Authentication Mechanism | Notes |
|---|---|---|---|---|
| **TB-1** Internet -> Gateway | Zone 0 | Zone 1 | TLS 1.2+, JWT Bearer token | Only public entry point |
| **TB-2** Gateway -> Services | Zone 1 | Zone 2 | X-User-Id/Roles headers (set by Gateway after JWT validation) | Headers stripped from client input |
| **TB-3** Service -> Service | Zone 2 | Zone 2 | X-Service-Token (internal JWT, 5-min TTL) | Private network; mTLS future goal |
| **TB-4** Service -> Database | Zone 2 | Zone 3 | Username/password, TLS connection | Credentials in Secrets Manager |
| **TB-5** Service -> Kafka | Zone 2 | Zone 4 | Currently plaintext; SASL/SSL planned | See roadmap |
| **TB-6** Service -> Secrets Manager | Zone 2 | AWS | IAM role (no static credentials) | No long-lived AWS keys in app |

---

## 3. Attack Surface Summary

### Public-Facing Endpoints

| Endpoint | Method | Auth Required | Notes |
|---|---|---|---|
| `/auth/login` | POST | No | Credential submission — brute-force risk |
| `/auth/register` | POST | No | Account creation — abuse risk |
| `/auth/refresh` | POST | Refresh token | Token rotation endpoint |
| `/api/**` | Various | Yes (JWT) | All business API endpoints |
| `/actuator/health` | GET | No | Liveness probe — info disclosure if over-exposed |

### Internal Attack Surface

| Component | Attack Vector | Exposure |
|---|---|---|
| JWT tokens | Theft, forgery, replay | Transmitted in every API request |
| Kafka topics | Unauthorized publish/consume, poison messages | Internal network only |
| Database connections | Credential theft, SQL injection | Private network, JPA parameterized queries |
| Environment variables / secrets | Container escape, misconfigured IAM | Secrets Manager in prod |
| Service-to-service tokens | Stolen X-Service-Token header | Internal network only |

---

## 4. STRIDE Analysis

### 4.1 Spoofing — "Can an attacker act as someone else?"

| Threat | Description | Affected Component | Likelihood | Impact |
|---|---|---|---|---|
| **S-01** Forged JWT | Attacker creates JWT with arbitrary claims | API Gateway, all services | Low | Critical |
| **S-02** JWT replay | Stolen valid token replayed after the victim logs out | API Gateway | Medium | High |
| **S-03** Service token impersonation | Attacker crafts X-Service-Token to call internal endpoints | Microservices | Low | High |
| **S-04** Credential stuffing on /auth/login | Using breached credentials to authenticate | Auth Service | High | High |

**Mitigations Implemented:**

- **S-01:** HS256 HMAC signature with `JWT_SECRET` (min 256-bit). Without the secret, forgery is computationally infeasible. Secret stored in AWS Secrets Manager, not in code.
- **S-02:** `jti` claim is a UUID; logout adds `jti` to Redis blocklist. Short 15-minute access token TTL limits replay window.
- **S-03:** Internal tokens validated by each service independently; `scope: service` claim required; short 5-minute TTL.
- **S-04:** Rate limiting at Gateway (20 req/min per IP on `/auth/login`); account lockout after 5 failed attempts; CAPTCHA integration point available.

---

### 4.2 Tampering — "Can an attacker modify data in transit or at rest?"

| Threat | Description | Affected Component | Likelihood | Impact |
|---|---|---|---|---|
| **T-01** Request body modification | MITM modifies API request between client and gateway | API Gateway | Low | Critical |
| **T-02** JWT payload tampering | Modifying JWT claims (e.g., changing `customerId`) | API Gateway | Low | Critical |
| **T-03** Kafka event tampering | Malicious actor modifies transaction events on Kafka topic | Kafka | Low | High |
| **T-04** Database record tampering | Direct DB modification bypassing application logic | PostgreSQL | Very Low | Critical |
| **T-05** Request header injection | Client injects `X-User-Id` header to impersonate another user | API Gateway | Medium | Critical |

**Mitigations Implemented:**

- **T-01:** TLS 1.2+ enforced at Gateway; HTTP is not accepted; HSTS header set.
- **T-02:** JWT signature validation — any change to the payload invalidates the signature. HS256 with server-held secret.
- **T-03:** Kafka is on a private network; producer identity validated by service-level authentication. Event signing is planned (see roadmap).
- **T-04:** DB user has limited privileges (no DDL in prod); `version` column on mutable entities for optimistic locking; immutable audit tables.
- **T-05:** Gateway strips all `X-User-Id`, `X-Customer-Id`, `X-User-Roles` headers from inbound client requests before adding its own validated values.

---

### 4.3 Repudiation — "Can an attacker deny performing an action?"

| Threat | Description | Affected Component | Likelihood | Impact |
|---|---|---|---|---|
| **R-01** Deny transaction was initiated | Customer claims they never submitted a transfer | Transaction Service | Medium | High |
| **R-02** Staff deny viewing customer data | Support user claims they never accessed an account | Account Service | Medium | Medium |
| **R-03** Log tampering | Attacker modifies application logs to remove evidence | Logging system | Low | High |

**Mitigations Implemented:**

- **R-01:** `transaction_audit` table records every state transition with `userId`, `timestamp`, `correlationId`, and `ipAddress` (from X-Forwarded-For). Table is append-only; no DELETE permission on audit tables in production DB user.
- **R-02:** `audit_logs` table in each service records all READ operations on sensitive resources for staff roles. Includes `X-Correlation-Id` for cross-service tracing.
- **R-03:** Application logs are shipped to a centralized log aggregator (CloudWatch Logs / ELK) with IAM-restricted write access. Application log files are append-only.

**Audit Log Schema (Key Fields):**

```sql
CREATE TABLE audit_logs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id     VARCHAR(50)  NOT NULL,  -- sub claim from JWT
    actor_role   VARCHAR(50)  NOT NULL,
    action       VARCHAR(100) NOT NULL,  -- e.g. 'ACCOUNT_READ', 'TRANSACTION_CREATE'
    resource_id  VARCHAR(100),
    ip_address   INET,
    correlation_id VARCHAR(50),
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No UPDATE or DELETE on this table in prod
);
```

---

### 4.4 Information Disclosure — "Can an attacker read data they should not?"

| Threat | Description | Affected Component | Likelihood | Impact |
|---|---|---|---|---|
| **I-01** PII in application logs | Full name, email, or account number logged in plaintext | All services | High | High |
| **I-02** Stack traces in error responses | Exception details exposing internal structure | All services | Medium | Medium |
| **I-03** Account number enumeration | Sequential or predictable account IDs | Account Service | Medium | Medium |
| **I-04** JWT claim exposure | Sensitive data encoded in JWT accessible by client | Auth Service | Low | Medium |
| **I-05** Cross-customer data leakage | Missing ownership check exposes other customer's data | All services | Low | Critical |

**Mitigations Implemented:**

- **I-01:** `MaskingUtil` applied in log patterns; MDC values are sanitized before logging. Account numbers masked to last 4 digits. Email masked to first 2 chars + `***@domain`.
- **I-02:** `@RestControllerAdvice` global exception handler returns only a structured error code and message; never the stack trace. Stack traces go to internal logs only.
- **I-03:** Account IDs are UUIDs (v4), not sequential integers.
- **I-04:** JWT payload is base64-encoded, not encrypted. No sensitive PII is placed in JWT claims — only identifiers.
- **I-05:** Resource ownership enforced at service layer on every CUSTOMER/PREMIUM request (see security-model.md section 6).

---

### 4.5 Denial of Service — "Can an attacker make the service unavailable?"

| Threat | Description | Affected Component | Likelihood | Impact |
|---|---|---|---|---|
| **D-01** API flood | High-volume requests exhaust gateway capacity | API Gateway | High | High |
| **D-02** Large payload DoS | Oversized request body exhausts memory | API Gateway | Medium | Medium |
| **D-03** Kafka consumer lag / poison pill | Malformed event blocks consumer | Kafka / Services | Medium | High |
| **D-04** Slow loris / connection exhaustion | Many slow connections exhaust connection pool | API Gateway | Low | Medium |
| **D-05** JWT brute-force on /auth/login | Password spraying generates many 401s and loads auth service | Auth Service | High | Medium |

**Mitigations Implemented:**

- **D-01:** Gateway rate limiter: 100 req/min per authenticated user, 20 req/min per anonymous IP using Redis-backed token bucket.
- **D-02:** `RequestSizeLimitFilter` rejects requests with body > 5 MB before any processing.
- **D-03:** Kafka consumers use Dead Letter Queue (DLQ). A message that fails deserialization or processing 3 times is routed to a `.DLQ` topic. Separate consumer group monitors DLQ and alerts on accumulation.
- **D-04:** Netty (Gateway) connection limits configured; request timeout set to 30 seconds.
- **D-05:** `/auth/login` rate limited per IP (20 req/min). Account lockout after 5 consecutive failures.

---

### 4.6 Elevation of Privilege — "Can an attacker gain capabilities beyond their role?"

| Threat | Description | Affected Component | Likelihood | Impact |
|---|---|---|---|---|
| **E-01** JWT role claim manipulation | Client modifies `roles` array in token payload | API Gateway | Low | Critical |
| **E-02** Horizontal privilege escalation | CUSTOMER accesses another customer's resources | All services | Medium | Critical |
| **E-03** SQL injection for admin access | Crafted input bypasses authorization at DB level | All services | Low | Critical |
| **E-04** IDOR on resource endpoints | Predictable IDs allow direct object reference | All services | Low | High |
| **E-05** Internal endpoint exposure | Gateway misconfiguration exposes internal-only routes | API Gateway | Low | High |

**Mitigations Implemented:**

- **E-01:** Roles are extracted from the validated, server-signed JWT. Any modification invalidates the HMAC signature. Gateway re-derives roles from the trusted JWT on every request.
- **E-02:** Service-layer ownership check: `account.getCustomerId().equals(principal.getCustomerId())`. Enforced before returning or modifying any resource for non-staff roles.
- **E-03:** All database access via JPA/Spring Data with parameterized queries. No native string-concatenated SQL. OWASP dependency check in CI pipeline.
- **E-04:** All resource IDs are UUIDs (v4); not guessable. Ownership check is still enforced even if ID is known.
- **E-05:** Internal service endpoints (`/internal/**`) are bound to `localhost` or a separate port not exposed through the Gateway route configuration.

---

## 5. Top 5 Critical Risks

Rated by combined Likelihood x Impact score (H=3, M=2, L=1):

| Rank | Risk ID | Description | Likelihood | Impact | Score | Primary Mitigation |
|---|---|---|---|---|---|---|
| 1 | S-04 | Credential stuffing on `/auth/login` | High (3) | High (3) | 9 | Rate limiting + account lockout |
| 2 | I-01 | PII leaking into application logs | High (3) | High (3) | 9 | MaskingUtil enforced in all log patterns |
| 3 | D-01 | API flood / volumetric DoS | High (3) | High (3) | 9 | Gateway rate limiter |
| 4 | E-02 | Horizontal privilege escalation (missing ownership check) | Medium (2) | Critical (3) | 6 | Resource ownership check in every service controller |
| 5 | T-05 | Client injects X-User-Id header to impersonate | Medium (2) | Critical (3) | 6 | Gateway strips and re-sets all user identity headers |

> **Note:** Any control covering a score-6+ risk must be covered by an automated integration test. Loss of this control is a P1 incident.

---

## 6. Accepted Risks

The following risks are known and have been deliberately accepted with documented rationale.

| Risk | Rationale | Review Date |
|---|---|---|
| Internal service comms are plaintext (non-mTLS) | All services run within a private VPC subnet. Network-level segmentation provides compensating control. mTLS is on the roadmap. | 2026-Q4 |
| HS256 (symmetric) JWT signing vs RS256 | Simpler key management for current scale. RS256 would allow services to verify tokens without sharing the secret. Acceptable until number of services exceeds 10. | 2027-Q1 |
| Kafka topics unauthenticated (no SASL/SSL) | Kafka broker is private network only; no external access. Low probability of network-level breach within current infrastructure. SASL/SSL planned. | 2026-Q4 |
| No WAF in front of Gateway (dev/staging) | Production deployment must include WAF. Dev/staging do not handle real customer data. | Per-environment |
| Refresh token stored hashed but not encrypted | Argon2 hash of refresh token stored in DB. Exposure of hash alone does not allow replay — the raw token is required. | 2027-Q1 |

---

## 7. Security Controls Not Yet Implemented

These are documented gaps on the security roadmap. Each has an assigned target quarter.

### 7.1 mTLS Between Internal Services — Target: Q4 2026

Currently service-to-service calls use JWT-based X-Service-Token authentication. Mutual TLS would add a second layer of identity assurance at the transport level.

**Required steps:**
1. Issue service identity certificates via internal CA (AWS Private CA or cert-manager).
2. Configure Spring Boot services with `server.ssl.*` and mutual auth settings.
3. Update Gateway routing to forward client certificate info.
4. Add certificate rotation automation (certificates expire; manual rotation is operationally risky).

### 7.2 Kafka SASL/SSL — Target: Q4 2026

Kafka producers and consumers currently connect without authentication.

**Required steps:**
1. Enable SASL/SCRAM-SHA-256 on the Kafka broker.
2. Create per-service Kafka users with ACLs limiting produce/consume to specific topics.
3. Enable TLS on Kafka listeners.
4. Update `application.yml` with `spring.kafka.properties.security.protocol=SASL_SSL`.

### 7.3 Kafka Event Signing — Target: Q1 2027

Kafka events can be tampered with at the broker level. Event signing ensures consumers can verify producer identity and message integrity.

**Approach:** Include an HMAC signature of the event payload as a Kafka message header. Consumer validates before processing.

### 7.4 Field-Level Encryption for PII — Target: Q2 2027

Currently PII (name, email, phone) is stored in plaintext in PostgreSQL (protected by disk-level RDS encryption). Field-level encryption adds protection against DB-level breaches.

**Approach:** Use a KMS-backed AES-256 key to encrypt PII columns before persistence. Key hierarchy: KMS master key -> per-tenant data key.

### 7.5 Anomaly-Based Rate Limiting — Target: Q2 2027

Current rate limiting is fixed (100 req/min). Anomaly-based limiting would detect and throttle unusual behavioral patterns (e.g., accessing 500 different accounts in 1 minute) independent of raw request volume.

### 7.6 MFA for Privileged Roles — Target: Q3 2026

`ROLE_ADMIN` and `ROLE_COMPLIANCE` users should require TOTP-based second factor at login. Integration point exists in auth-service `AuthController.login()`.

### 7.7 SIEM Integration — Target: Q3 2027

Centralize security events (failed auth, rate limit breaches, RBAC violations, anomalies) into a SIEM for real-time alerting and forensic investigation.

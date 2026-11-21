# Threat Model (STRIDE)

## 1. Scope

Assets we protect:

| Asset | Why it matters |
|-------|----------------|
| Account balances and the ledger | Direct financial loss |
| Transaction records and saga state | Correctness of money movement |
| Customer PII (name, email, phone) | Privacy, regulation |
| JWT signing secret | Whoever has it can impersonate anyone, including admins |
| Audit log | Evidence for disputes and regulators |
| Fraud rules and alerts | Bypassing them enables fraud |

## 2. Trust boundaries

```
 [Internet / browser] ──(1)──► [api-gateway] ──(2)──► [services] ──(3)──► [Postgres]
                                                         │
                                                        (4)
                                                         ▼
                                                      [Kafka]
```

1. Untrusted client → gateway (public).
2. Gateway → services (internal network, but treated as untrusted: services re-validate JWT).
3. Services → their databases.
4. Services ↔ Kafka (any service with Kafka access can publish to any topic today).

## 3. STRIDE analysis

### S — Spoofing

| Threat | Mitigation | Residual risk |
|--------|------------|---------------|
| Attacker guesses/steals a password | Credentials checked by gateway; demo passwords only for local | No rate limiting/lockout yet → add at gateway |
| Forged JWT | HMAC signature verified in gateway **and** every service | Secret leak = full compromise (see secret-management) |
| Caller sets `X-User-Id: ADMIN-1` directly on a service port | Services ignore headers for identity; they trust only the validated token | – |
| Fake event published to Kafka (e.g. a forged `FRAUD_CLEARED`) | Network isolation of Kafka | **Open**: no Kafka ACLs/auth locally. Production: SASL + ACLs so only fraud-service can write `banking.fraud.events` |

### T — Tampering

| Threat | Mitigation | Residual risk |
|--------|------------|---------------|
| Modify amount in transit | TLS in production; validation on DTOs | Local HTTP is plain |
| Change someone else's account via API | Ownership checks (`requireOwnerOrAdmin`) | – |
| Transfer from someone else's account | Ownership checked in transaction-service **and** again in account-service for the saga | – |
| Edit audit logs to hide activity | DB triggers block UPDATE/DELETE/TRUNCATE | A DB superuser can drop triggers → separate DB roles in production |
| Race conditions / double spend | Pessimistic locks on balances in consistent order, one DB transaction, idempotency per `transactionId` | – |
| Replay of a transfer request | `Idempotency-Key` + unique index; consumers dedupe by `eventId` | Clients that don't send the key can double-submit (fraud velocity rule helps) |

### R — Repudiation

| Threat | Mitigation |
|--------|------------|
| Customer denies making a transfer | `initiatedBy` stored on the transaction; audit log with actor, correlation id, timestamps |
| Admin denies freezing an account / approving an alert | `changedBy` in status history, `reviewedBy` + notes on alerts, audit entries |
| Unclear sequence of events | `correlationId` across all events; `X-Trace-Id` in request logs |

### I — Information disclosure

| Threat | Mitigation | Residual risk |
|--------|------------|---------------|
| Customer reads other customers' data | Ownership filtering on all list/get endpoints | – |
| PII in logs | `MaskingUtil` in audit details and logs; masked recipient in notification API | Developers must keep using it |
| Stack traces in error responses | `BaseGlobalExceptionHandler` returns `ApiResponse.error` with generic message for `INTERNAL_ERROR` | – |
| Secrets in git | Env vars, defaults only for local; secret scanning in CI | Default dev secret is public → must be overridden outside local |
| Actuator endpoints leak info | Only `health`, `info`, `metrics`, `prometheus` exposed | `prometheus` public → restrict in production |
| Database exposed | Port 5432 only published locally | Production: private network |

### D — Denial of service

| Threat | Mitigation | Residual risk |
|--------|------------|---------------|
| Flood of requests | Circuit breakers per route protect downstream services | No rate limiting yet |
| Poison Kafka message blocks a partition | 3 retries then DLT | – |
| Slow downstream service | Async saga; Kafka buffers; circuit breaker fallback 503 | – |
| Saga waiting forever | Timeout job (15 min) | `AWAITING_REVIEW` waits for humans by design |
| Large page sizes | `size` max 100 | – |

### E — Elevation of privilege

| Threat | Mitigation | Residual risk |
|--------|------------|---------------|
| Customer calls admin endpoint | `@PreAuthorize("hasRole('ADMIN')")` on admin endpoints | Must be added to every new admin endpoint (review checklist) |
| Customer opens account for another customer | `customerId` only honoured for admins | – |
| Token with modified roles | Signature check | – |
| Compromised service mints admin tokens (shared secret) | – | Move to asymmetric keys: only the gateway holds the private key |

## 4. Top risks and actions

| # | Risk | Action |
|---|------|--------|
| 1 | Unauthenticated Kafka allows forged events | SASL/TLS + per-topic ACLs in production |
| 2 | Shared HMAC secret | RS256 with gateway-only private key, JWKS for services |
| 3 | No login rate limit | Redis-based rate limiter at the gateway + lockout |
| 4 | Default secrets usable outside local | Fail startup in non-dev profiles if `JWT_SECRET` equals the default |
| 5 | DB superuser can disable audit triggers | Separate owner/app roles; app role has INSERT/SELECT only on `audit_logs` |

## 5. Review

Revisit this model when adding a new service, a new external integration (real SMS/email provider,
payment network) or changing authentication.

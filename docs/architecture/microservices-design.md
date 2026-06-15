# Microservices Design

## Table of Contents

1. [Overview](#overview)
2. [Service Boundaries and Single Responsibility](#service-boundaries-and-single-responsibility)
3. [Service Reference Table](#service-reference-table)
4. [Inter-Service Communication Patterns](#inter-service-communication-patterns)
5. [Data Ownership](#data-ownership)
6. [Service Discovery](#service-discovery)
7. [Resiliency Patterns](#resiliency-patterns)
8. [Scaling Considerations](#scaling-considerations)
9. [Health Check Strategy](#health-check-strategy)
10. [Dependency Graph](#dependency-graph)

---

## Overview

The banking platform is composed of six independently deployable microservices. Each service owns a single business capability, a dedicated PostgreSQL schema, and its own Kafka consumer group. Services communicate synchronously over REST only at the API boundary (external client to gateway); all internal coordination between business services is asynchronous via Apache Kafka. This separation allows each service to be scaled, deployed, and failed independently without cascading outages.

**Technology baseline:**
- Runtime: Java 21, Spring Boot 3.2.5
- Messaging: Apache Kafka
- Persistence: PostgreSQL 16 (one logical schema per service)
- Schema management: Flyway
- Containerisation: Docker / Docker Compose
- Build: Maven multi-module

---

## Service Boundaries and Single Responsibility

### api-gateway (port 8080)

**Responsibility:** Single ingress point for all client traffic. Validates JWTs, enforces rate limiting, routes authenticated requests to downstream services, and aggregates health status for external monitoring.

**What it owns:**
- JWT validation logic (shared signing key or JWKS endpoint)
- Route configuration per downstream service
- Rate-limit counters (in-memory; Redis for multi-replica deployments)

**What it does NOT own:**
- Any business entity (accounts, transactions, fraud records, etc.)
- Any database schema
- Any Kafka topics

The gateway is a pure routing and security enforcement layer. It never writes to a domain database and never produces Kafka events. Adding a new downstream service requires only a new route entry in the gateway configuration — no other service is affected.

---

### account-service (port 8081)

**Responsibility:** Lifecycle management of bank accounts. Creates accounts, manages account status transitions (ACTIVE → FROZEN → CLOSED), maintains the authoritative account balance, and enforces balance reservation semantics required by the distributed saga.

**What it owns:**
- `accounts` PostgreSQL schema (accounts table, outbox_events table)
- `account.created` Kafka topic (producer)
- `account.status.changed` Kafka topic (producer)
- Balance reservation and release REST endpoints consumed by the saga orchestrator

**What it does NOT own:**
- Transaction records (owned by transaction-service)
- Fraud decisions (owned by fraud-service)
- Notification delivery records (owned by notification-service)

The account-service is the system of record for account identity and balance. No other service may write to the `accounts` schema. Balance mutations are the most sensitive operations in the platform and are protected by optimistic locking (`version` column) to prevent lost updates.

---

### transaction-service (port 8082)

**Responsibility:** Initiates, orchestrates, and records money transfers. Hosts the `TransactionSagaOrchestrator`, which drives the multi-step distributed transaction across account-service and fraud-service. Maintains the full lifecycle of every transaction record from INITIATED through COMPLETED or FAILED.

**What it owns:**
- `transactions` PostgreSQL schema (transactions table, saga_state table, outbox_events table)
- `transaction.initiated` Kafka topic (producer)
- `transaction.processing` Kafka topic (producer/consumer, used for internal saga step signalling)
- `transaction.completed` Kafka topic (producer)
- `transaction.failed` Kafka topic (producer)

**What it does NOT own:**
- Account balances (must call account-service REST API to reserve, release, debit, or credit)
- Fraud scoring logic (delegated to fraud-service via Kafka)

The transaction-service is the saga orchestrator. It drives other services by publishing Kafka events and reacts to result events. It is the single source of truth for whether a given money transfer succeeded or failed.

---

### fraud-service (port 8083)

**Responsibility:** Evaluates transactions for fraud risk. Consumes `transaction.initiated` events, applies fraud rules (velocity checks, amount thresholds, geo-anomaly detection, device fingerprinting), and emits a `fraud.decision` event with an APPROVED or REJECTED outcome. Also emits `fraud.detected` for downstream alerting when a transaction is definitively flagged as fraudulent.

**What it owns:**
- `fraud` PostgreSQL schema (fraud_checks table, fraud_rules table, velocity_counters table)
- `fraud.decision` Kafka topic (producer)
- `fraud.detected` Kafka topic (producer)

**What it does NOT own:**
- Transaction state (reads event payload only; never queries the transactions schema)
- Account data (balance, status)

Fraud-service is a pure event-driven processor. It exposes no REST API that other services call. All input arrives via Kafka; all output departs via Kafka. This makes the fraud evaluation engine trivially replaceable with a machine-learning model or a third-party provider without touching any other service.

---

### notification-service (port 8084)

**Responsibility:** Delivers user-facing notifications (email, SMS, push) when significant account or transaction events occur. Consumes events from multiple topics, resolves the appropriate user contact information from the event payload, selects a notification template, and routes to the delivery channel.

**What it owns:**
- `notifications` PostgreSQL schema (notification_log table, notification_templates table, delivery_attempts table)
- Consumer subscriptions to: `transaction.completed`, `transaction.failed`, `fraud.detected`, `account.created`, `account.status.changed`, `notification.requested`

**What it does NOT own:**
- Business logic that determines whether a notification is warranted (that decision is made by the event producer)
- Account or transaction data beyond what is carried in the event payload
- Any Kafka topics as a producer

Notification-service is a fan-out consumer. It has no REST API consumed by other business services. Its failure does not affect transaction processing.

---

### audit-service (port 8085)

**Responsibility:** Immutable compliance audit trail. Consumes all significant domain events from all topics and writes append-only audit records. Provides a query REST API for compliance reviews and fraud investigations.

**What it owns:**
- `audit` PostgreSQL schema (audit_events table — append-only; no UPDATE or DELETE is ever issued)
- Consumer subscriptions to all topics

**What it does NOT own:**
- Any mutable state
- Any Kafka topic as a producer

Audit-service is a read-only event projection. Its database is written only from Kafka event consumption. Schema changes to the audit table are strictly additive. The service can be rebuilt from scratch by replaying all Kafka topics from offset 0, provided retention is sufficient.

---

## Service Reference Table

| Service             | Port | DB Schema     | Kafka Role        | Topics Produced                                                                             |
|---------------------|------|---------------|-------------------|---------------------------------------------------------------------------------------------|
| api-gateway         | 8080 | None          | None              | None                                                                                        |
| account-service     | 8081 | accounts      | Producer          | `account.created`, `account.status.changed`                                                 |
| transaction-service | 8082 | transactions  | Producer/Consumer | `transaction.initiated`, `transaction.processing`, `transaction.completed`, `transaction.failed` |
| fraud-service       | 8083 | fraud         | Producer/Consumer | `fraud.decision`, `fraud.detected`                                                          |
| notification-service| 8084 | notifications | Consumer only     | None                                                                                        |
| audit-service       | 8085 | audit         | Consumer only     | None                                                                                        |

Dead Letter Topics (DLT) follow the naming convention `<topic-name>.DLT` and exist for every topic.

---

## Inter-Service Communication Patterns

### Synchronous REST — When and Why

REST is used exclusively for three scenarios:

**1. External client to gateway:**
Every API call from a mobile app, web frontend, or third-party integration enters through the gateway over HTTPS/REST. The gateway validates the JWT and forwards the request to the appropriate downstream service.

**2. Gateway to downstream routing:**
The gateway forwards authenticated requests to `account-service` (account management) and `transaction-service` (transfer initiation) via internal REST calls. These are user-facing operations where synchronous request-response semantics are required.

**3. Saga orchestrator to account-service (balance operations):**
The `TransactionSagaOrchestrator` in `transaction-service` calls `account-service` REST endpoints to:
- Reserve a balance hold before fraud evaluation
- Release the hold if fraud is rejected or the saga times out
- Apply a debit to the sender's account after fraud approval
- Apply a credit to the receiver's account after the debit succeeds

These operations must be synchronous because the saga cannot advance to the next step until account-service confirms the balance mutation has been durably committed.

**REST call settings:**
```
Connection timeout : 2 seconds
Read timeout       : 5 seconds
HTTP client        : Spring Boot RestClient (Java 21 HttpClient)
Retry              : 2 retries, exponential backoff (100 ms → 200 ms)
Retry triggers     : 5xx responses, connection refused, timeout
Circuit breaker    : Resilience4j, 50% error rate threshold, 10-second open window
```

### Asynchronous Kafka — When and Why

Kafka is used for all scenarios where:
- The producing service does not need an immediate answer before continuing
- Multiple consumers need the same event (fan-out)
- The operation must be durably recorded for replay or audit
- The consumer may be slow or temporarily unavailable

Specific use cases:

**Domain event notification:** When account-service creates an account or changes its status, it publishes an event to Kafka. Notification-service and audit-service react independently; neither service needs to be aware of the other's existence.

**Saga step coordination:** After the transaction-service publishes `transaction.initiated`, it does not block waiting for fraud-service. Fraud-service consumes the event, evaluates the transaction, and produces `fraud.decision`. The saga orchestrator resumes when it consumes that decision event.

**Audit and compliance fan-out:** Audit-service subscribes to all topics. New consumers can be added without changing any producer.

### Decision Matrix

| Scenario                                    | Protocol | Justification                                                    |
|---------------------------------------------|----------|------------------------------------------------------------------|
| Client submits transfer request             | REST     | User waits for acknowledgment; gateway must validate JWT         |
| Account balance reservation in saga         | REST     | Saga cannot advance until balance confirmation is received       |
| Signal fraud-service of new transaction     | Kafka    | Fire-and-forget; fraud evaluation latency is variable            |
| Deliver fraud decision to saga orchestrator | Kafka    | Decouples fraud latency from saga; supports at-least-once retry  |
| Notify audit-service of state change        | Kafka    | Fan-out; audit-service must not be coupled to producers          |
| Deliver user notification                   | Kafka    | Non-critical path; DLT handles delivery failures                 |

---

## Data Ownership

Each service is the sole owner of its PostgreSQL schema. This rule is enforced at multiple levels:

**Database credential isolation:** Each service's `DataSource` uses credentials with `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA <schema> TO <service_user>`. No service user has access to another service's schema.

**No cross-schema SQL:** No SQL query in any service joins across schema boundaries. Cross-service data requirements are satisfied by reading Kafka event payloads (projection pattern) or calling a REST API owned by the authoritative service.

**Flyway isolation:** Each service's Maven module contains its own `src/main/resources/db/migration/` directory. Migrations are applied only at startup of the owning service.

### Schema Isolation Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  PostgreSQL 16 Instance (banking_db)                            │
│                                                                 │
│  ┌───────────────┐  ┌────────────────┐  ┌───────────────────┐  │
│  │   accounts    │  │  transactions  │  │      fraud        │  │
│  │   (schema)    │  │   (schema)     │  │     (schema)      │  │
│  │               │  │                │  │                   │  │
│  │ account-svc   │  │ txn-service    │  │ fraud-service     │  │
│  │ credentials   │  │ credentials    │  │ credentials       │  │
│  │ ONLY          │  │ ONLY           │  │ ONLY              │  │
│  └───────────────┘  └────────────────┘  └───────────────────┘  │
│                                                                 │
│  ┌───────────────┐  ┌────────────────┐                         │
│  │ notifications │  │    audit       │                         │
│  │   (schema)    │  │   (schema)     │                         │
│  │               │  │                │                         │
│  │ notif-svc     │  │ audit-svc      │                         │
│  │ credentials   │  │ credentials    │                         │
│  │ ONLY          │  │ ONLY           │                         │
│  └───────────────┘  └────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Service Discovery

### Development — Docker Compose (Static DNS)

In development and local integration testing, services communicate using static container DNS names defined in `docker-compose.yml`. Each service is reachable at its container service name on the Docker bridge network:

```yaml
# Example environment block for transaction-service in docker-compose.yml
environment:
  ACCOUNT_SERVICE_BASE_URL: http://account-service:8081
  SPRING_KAFKA_BOOTSTRAP_SERVERS: kafka:9092
  SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/banking_db?currentSchema=transactions
```

No service registry (Eureka, Consul, Zookeeper) is used in development. Static environment variables are the source of truth for all service coordinates, which eliminates a class of operational dependencies during local development and CI.

### Production — Kubernetes (ClusterIP DNS)

In production Kubernetes, each service is exposed as a `ClusterIP` Kubernetes Service. The cluster DNS resolves service names following the pattern:

```
<service-name>.<namespace>.svc.cluster.local:<port>
```

Example:
```
http://account-service.banking.svc.cluster.local:8081
```

Environment variables are injected via Kubernetes `ConfigMaps` and `Secrets`, maintaining the same interface as the Docker Compose configuration. Application code never contains hardcoded hostnames.

---

## Resiliency Patterns

### api-gateway

| Pattern         | Configuration                                                                      |
|-----------------|------------------------------------------------------------------------------------|
| Circuit Breaker | Per-route Resilience4j CB; opens at 50% failure rate over a 10-call sliding window|
| Timeout         | 10 seconds per upstream request                                                    |
| Rate Limiting   | 100 requests/second per client IP; HTTP 429 on breach                             |
| Retry           | No retry at gateway level — retries are the client's responsibility               |
| Fallback        | Structured JSON error body (`503 Service Unavailable`) when circuit is open       |

### account-service

| Pattern         | Configuration                                                                      |
|-----------------|------------------------------------------------------------------------------------|
| Startup retry   | Flyway migration: 5 attempts, 10-second interval before failing startup            |
| Idempotency     | Balance reservation via idempotency key (reservationId UUID); duplicate calls safe|
| Optimistic lock | `version` column on accounts row; StaleObjectStateException triggers caller retry |
| Outbox relay    | At-least-once Kafka delivery; see `outbox-pattern.md`                             |

### transaction-service

| Pattern         | Configuration                                                                      |
|-----------------|------------------------------------------------------------------------------------|
| Circuit Breaker | Resilience4j CB on account-service REST calls; 50% failure threshold              |
| Retry           | 2 retries on account-service calls; 100 ms / 200 ms backoff                      |
| Read timeout    | account-service call: 5-second read timeout                                        |
| Saga timeout    | `@Scheduled` job detects stuck sagas; thresholds defined per step                 |
| Outbox relay    | At-least-once Kafka delivery; see `outbox-pattern.md`                             |
| Distributed lock| ShedLock on outbox relay `@Scheduled` to prevent duplicate publishing in multi-replica deployments |

### fraud-service

| Pattern         | Configuration                                                                      |
|-----------------|------------------------------------------------------------------------------------|
| Consumer retry  | Spring Kafka retry template: 3 attempts, 1-second linear backoff                  |
| DLT routing     | After 3 retries, message is routed to `transaction.initiated.DLT`                 |
| Idempotency     | Fraud check result keyed by transactionId; duplicate `transaction.initiated` events are skipped if result already exists |

### notification-service

| Pattern         | Configuration                                                                      |
|-----------------|------------------------------------------------------------------------------------|
| Consumer retry  | 3 attempts per message before DLT                                                  |
| Delivery retry  | Email/SMS channel: up to 5 exponential backoff retries (1s, 2s, 4s, 8s, 16s)    |
| DLT             | `notification.requested.DLT` for permanently undeliverable notifications           |
| Idempotency     | Notification log keyed by eventId; duplicate events do not produce duplicate sends|

### audit-service

| Pattern         | Configuration                                                                      |
|-----------------|------------------------------------------------------------------------------------|
| Consumer retry  | 5 attempts; audit records must not be silently dropped                            |
| DLT             | `*.DLT` topics are monitored; manual replay from Kafka offset is the recovery path|
| Append-only     | No UPDATE/DELETE; a write failure is always retryable without side effects         |

---

## Scaling Considerations

### Stateless Services (Horizontally Scalable Without Constraint)

**api-gateway:** No local mutable state. Rate-limit counters can be externalised to Redis for multi-replica deployments. Scale to any replica count behind a load balancer or Kubernetes Ingress.

**fraud-service:** No persistent local state beyond the shared `fraud` schema. Multiple replicas participate in the same Kafka consumer group (`fraud-service-group`). Kafka distributes `transaction.initiated` partitions across replicas automatically. Scaling fraud-service adds evaluation parallelism bounded by the number of topic partitions.

**notification-service:** Stateless JVM process. Multiple replicas share the `notification-service-group` consumer group. Delivery channel SDK clients (JavaMail, Twilio) are thread-safe and connection-pooled.

**audit-service:** Stateless JVM process. Scales with the partition count of consumed topics. No ordering constraints across topics, only per-partition ordering is required.

### Services With State Constraints

**account-service:** Owns the authoritative account balance in PostgreSQL. The JVM tier is stateless and can scale horizontally. Concurrent balance mutations across replicas are serialised via optimistic locking on the `version` column. HikariCP connection pool must be sized per replica (`maximumPoolSize` × replica count ≤ PostgreSQL `max_connections`).

**transaction-service:** Hosts the saga orchestrator. Saga state is persisted in PostgreSQL, so multiple replicas are safe — each replica processes a distinct set of Kafka partitions. The outbox relay `@Scheduled` method is protected by ShedLock (`lockAtMostFor=PT10S`) to ensure exactly one replica holds the lock at any time, preventing duplicate Kafka publishes.

### Partition Planning Recommendations

| Topic                    | Recommended Partitions | Rationale                                          |
|--------------------------|------------------------|----------------------------------------------------|
| transaction.initiated    | 12                     | High volume; supports up to 12 fraud-service pods  |
| transaction.completed    | 12                     | Symmetric with initiated                           |
| transaction.failed       | 12                     | Symmetric with initiated                           |
| transaction.processing   | 12                     | Internal saga signalling                           |
| account.created          | 6                      | Lower volume; account creation rate is bounded     |
| account.status.changed   | 6                      | Low volume; status changes are rare                |
| fraud.decision           | 12                     | 1:1 response ratio with transaction.initiated      |
| fraud.detected           | 6                      | Subset of decisions; flagged transactions only     |
| notification.requested   | 6                      | Bounded by transaction volume                      |

---

## Health Check Strategy

All services expose Spring Boot Actuator endpoints. The aggregate health check reflects database connectivity, Kafka producer/consumer liveness, and disk space.

### Actuator Configuration (applied to all services)

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health, info, prometheus, metrics
      base-path: /actuator
  endpoint:
    health:
      show-details: always
      probes:
        enabled: true
  health:
    kafka:
      enabled: true
    db:
      enabled: true
    diskspace:
      enabled: true
```

This exposes:

| Endpoint                        | Purpose                                                                     |
|---------------------------------|-----------------------------------------------------------------------------|
| `GET /actuator/health`          | Aggregate health including all components                                   |
| `GET /actuator/health/liveness` | Kubernetes liveness probe — is the JVM alive and responsive?               |
| `GET /actuator/health/readiness`| Kubernetes readiness probe — is the service ready to accept traffic?        |
| `GET /actuator/prometheus`      | Prometheus-format metrics for Grafana dashboards                            |

### Liveness vs Readiness Semantics

| Probe     | Fails When                                                                   | Kubernetes Response             |
|-----------|------------------------------------------------------------------------------|---------------------------------|
| Liveness  | JVM deadlock, OOM, process unresponsive (health check timeout)              | Kill and restart the container  |
| Readiness | Database pool exhausted, Kafka broker unreachable, Flyway migration pending | Remove pod from Service endpoints (stop routing traffic) |

**Design decision:** Liveness probes do NOT check database connectivity. A transient database blip would cause a pod restart, which does not restore database connectivity and introduces unnecessary churn. Readiness probes check the database because a service cannot correctly process requests without it.

### Kubernetes Probe Configuration (transaction-service example)

```yaml
livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8082
  initialDelaySeconds: 45
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8082
  initialDelaySeconds: 30
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 5
```

`initialDelaySeconds` for readiness is set lower than for liveness to allow the pod to enter the ready state as soon as Flyway migrations complete, without waiting for the full liveness window.

---

## Dependency Graph

```
                      ┌─────────────────────────────┐
                      │          CLIENT             │
                      │  (browser / mobile / API)   │
                      └──────────────┬──────────────┘
                                     │ HTTPS REST
                                     ▼
                      ┌─────────────────────────────┐
                      │        api-gateway          │
                      │          :8080              │
                      │  - JWT validation           │
                      │  - Rate limiting            │
                      │  - Route forwarding         │
                      └──────┬──────────────┬───────┘
                             │ REST         │ REST
                             ▼             ▼
            ┌────────────────────┐   ┌─────────────────────────┐
            │  account-service   │◄──│   transaction-service   │
            │      :8081         │   │        :8082            │
            │                    │   │  (saga orchestrator)    │
            │ DB: accounts       │   │  DB: transactions       │
            │ Produces:          │   │  Produces:              │
            │  account.created   │   │   txn.initiated         │
            │  account.status    │   │   txn.processing        │
            │  .changed          │   │   txn.completed         │
            └────────┬───────────┘   │   txn.failed            │
                     │               └────────────┬────────────┘
                     │ (account.*)                │ (txn.*)
                     └──────────────┬─────────────┘
                                    │
                                    ▼
                   ┌────────────────────────────────────┐
                   │           Apache Kafka             │
                   │                                    │
                   │  account.created                   │
                   │  account.status.changed            │
                   │  transaction.initiated             │
                   │  transaction.processing            │
                   │  transaction.completed             │
                   │  transaction.failed                │
                   │  fraud.decision                    │
                   │  fraud.detected                    │
                   │  notification.requested            │
                   │  (+ *.DLT variants)                │
                   └──┬───────────────┬───────────┬─────┘
                      │               │           │
             ┌────────┘    ┌──────────┘           └────────┐
             │             │                               │
             ▼             ▼                               ▼
  ┌──────────────────┐ ┌────────────────────┐ ┌───────────────────────┐
  │  fraud-service   │ │ notification-svc   │ │    audit-service      │
  │     :8083        │ │      :8084         │ │       :8085           │
  │                  │ │                    │ │                       │
  │ Consumes:        │ │ Consumes:          │ │ Consumes: ALL topics  │
  │  txn.initiated   │ │  txn.completed     │ │                       │
  │                  │ │  txn.failed        │ │ Writes: append-only   │
  │ Produces:        │ │  fraud.detected    │ │ audit records         │
  │  fraud.decision  │ │  acct.created      │ │                       │
  │  fraud.detected  │ │  acct.status.*     │ │ DB: audit             │
  │                  │ │  notif.requested   │ │                       │
  │ DB: fraud        │ │  DB: notifications │ └───────────────────────┘
  └────────┬─────────┘ └────────────────────┘
           │
           │ Kafka (fraud.decision)
           ▼
  ┌─────────────────────────────┐
  │   transaction-service       │
  │   saga: consumes result,    │
  │   advances state machine    │
  └─────────────────────────────┘

  REST call direction:  ──►  (synchronous, blocking)
  Kafka event flow:     ──►  (asynchronous, at-least-once)
```

### Dependency Summary

| Service             | Synchronous REST Deps   | Kafka Consumer Dependencies                      | Kafka Producer Dependencies |
|---------------------|-------------------------|--------------------------------------------------|-----------------------------|
| api-gateway         | account-svc, txn-svc    | None                                             | None                        |
| account-service     | None                    | None                                             | account.created, account.status.changed |
| transaction-service | account-service         | fraud.decision                                   | transaction.* topics        |
| fraud-service       | None                    | transaction.initiated                            | fraud.decision, fraud.detected |
| notification-service| None                    | txn.completed, txn.failed, fraud.detected, acct.* | None                      |
| audit-service       | None                    | All topics                                       | None                        |

Key architectural properties:
- `fraud-service`, `notification-service`, and `audit-service` have zero synchronous REST dependencies on other business services. They can be taken offline or deployed independently without affecting the transaction flow.
- `audit-service` is the most isolated service: it depends only on Kafka and its own database.
- No service depends on `notification-service` or `audit-service` at runtime, making them safe to restart, redeploy, or scale without a maintenance window.

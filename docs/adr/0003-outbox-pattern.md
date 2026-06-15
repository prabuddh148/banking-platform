# ADR-0003: Use the Outbox Pattern for Reliable Kafka Event Publishing

**Status:** Accepted

**Date:** 2024-01-29

**Deciders:** Platform Engineering Team

**Technical Area:** Data Consistency, Event Publishing

---

## Context

Every service in the banking platform must publish Kafka events when domain state changes. For example:

- The account-service publishes `account.created` when an account is saved to the database.
- The transaction-service publishes `transaction.initiated` when a new transaction is persisted.
- The fraud-service publishes `fraud.decision` when a risk evaluation is complete.

The fundamental challenge is that publishing to Kafka and writing to PostgreSQL are two separate operations. There is no distributed transaction that spans both systems. This creates a **dual-write problem**: any approach that writes to the database and then publishes to Kafka can fail between the two steps, leaving them permanently out of sync.

**Scenarios that cause data loss or inconsistency without a solution:**

1. **Write succeeds, Kafka publish fails:** The account is created in the database, but `account.created` is never published. The fraud-service never creates a risk profile for the account. The notification-service never sends a welcome message.

2. **Kafka publish succeeds, write fails (transaction rollback):** The event is published to Kafka, but the database write is rolled back due to a constraint violation or application error. Downstream services process an event for an account that does not exist in the source system.

3. **Application crashes between steps:** The JVM crashes after writing to the database but before the Kafka `producer.send()` call completes. Same result as scenario 1.

**Dual-write without a transaction is not safe for financial systems.** Even a low failure rate (1 in 10,000 transactions) translates to significant data inconsistency at scale and creates compliance and audit issues.

**Alternatives Considered**

### Option A: Synchronous Kafka publish inside database transaction

Call `producer.send()` inside a Spring `@Transactional` method, before the commit. The idea is that if Kafka publish fails, the transaction rolls back.

This does not work reliably because:
- Kafka producer operations are asynchronous. By default, `producer.send()` returns a `Future` — the actual network operation happens in a background thread after the method returns, meaning the database transaction may have already committed.
- Even with synchronous `producer.send(get())` calls, the database transaction has no awareness of the Kafka send result. If Kafka send fails after the transaction commit begins, there is no mechanism to roll back the committed database write.
- Kafka does not participate in JTA distributed transactions (and using JTA with Kafka is not supported in standard Spring configurations).

### Option B: Kafka Transactions with exactly-once semantics

Kafka supports producer transactions and exactly-once semantics (EOS) within Kafka itself. However, this only guarantees exactly-once delivery *between Kafka topics*, not across a Kafka topic and a PostgreSQL database. The database write still falls outside the Kafka transaction boundary.

### Option C: Event Sourcing

Store all state changes as events in an append-only event log (the database IS the event log). Publish from the event log. This solves the dual-write problem but requires a fundamental architectural shift. The team evaluated this and determined it adds significant complexity (event versioning, snapshot management, event schema evolution) that is not justified for the current project phase. We may revisit event sourcing for specific bounded contexts in the future.

### Option D: Change Data Capture (CDC) with Debezium

Use Debezium to tail the PostgreSQL Write-Ahead Log (WAL) and publish change events to Kafka. This is the most robust solution and completely eliminates the dual-write problem. However, it requires deploying and operating Debezium Connect, managing connector configurations, handling schema registry, and dealing with WAL ordering complexity. This was deemed too operationally complex for the current phase but is the preferred migration target for production scale.

---

## Decision

We will implement the **Outbox Pattern** in each service that publishes Kafka events.

**How it works:**

1. Each service maintains an `outbox_events` table in its own database (co-located with the domain table it writes to).

2. When a domain entity is created or modified, the service writes both the entity change and an outbox event record in the **same local ACID database transaction**. If the transaction rolls back, the outbox record is also rolled back — they are always consistent.

3. A background component (the **Outbox Relay**) periodically polls the `outbox_events` table for unprocessed records, publishes them to Kafka, and marks them as processed only after Kafka acknowledges receipt.

4. Published events are retained in the outbox table for 7 days for debugging purposes, then purged by a scheduled cleanup job.

**Outbox table schema (per service):**

```sql
CREATE TABLE outbox_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    aggregate_type  VARCHAR(100)  NOT NULL,  -- e.g., 'Account', 'Transaction'
    aggregate_id    VARCHAR(255)  NOT NULL,  -- entity ID (UUID string)
    event_type      VARCHAR(255)  NOT NULL,  -- e.g., 'account.created'
    topic           VARCHAR(255)  NOT NULL,  -- Kafka topic name
    partition_key   VARCHAR(255)  NOT NULL,  -- Kafka partition key
    payload         JSONB         NOT NULL,  -- serialized event body
    status          VARCHAR(20)   NOT NULL DEFAULT 'PENDING',  -- PENDING | PUBLISHED | FAILED
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    published_at    TIMESTAMPTZ,
    retry_count     INTEGER       NOT NULL DEFAULT 0,
    last_error      TEXT,
    headers         JSONB                    -- Kafka headers (trace-id, correlation-id, etc.)
);

CREATE INDEX idx_outbox_status_created ON outbox_events(status, created_at)
    WHERE status = 'PENDING';
```

**Outbox Relay implementation:**

The `OutboxRelayScheduler` runs every 100ms (configurable) and:
1. Selects up to N `PENDING` records ordered by `created_at` using `SELECT ... FOR UPDATE SKIP LOCKED` to safely support multiple application instances.
2. Publishes each event to Kafka using `KafkaTemplate.send()` with a synchronous result wait.
3. On success: marks the record `PUBLISHED` and sets `published_at`.
4. On Kafka error: increments `retry_count`, sets `last_error`, and (after max retries) marks `FAILED`.
5. FAILED events trigger an alert and require manual intervention.

**At-least-once delivery and idempotency:**

The outbox relay delivers events at-least-once. The relay may publish an event and then crash before marking it PUBLISHED in the database, causing the event to be published again on the next relay run. All Kafka consumers must be designed to handle duplicate events gracefully by implementing idempotent processing (checking whether the event's aggregate ID + event type has already been processed before applying changes).

---

## Consequences

### Positive

**Guaranteed consistency between database and Kafka:** The outbox record and the domain entity are always written in the same ACID transaction. It is impossible for the domain state to change without a corresponding outbox record, and impossible for an outbox record to exist without the domain change being committed.

**No lost events:** If the application crashes after the database commit but before Kafka publish, the outbox record remains PENDING. The next application instance to start (or the next relay run) will publish it. Events are never silently dropped.

**No phantom events:** If the database transaction rolls back (constraint violation, optimistic lock failure, application error), the outbox record rolls back with it. Kafka will never receive an event for a state change that did not actually commit to the database.

**Operational simplicity:** No external infrastructure beyond PostgreSQL and Kafka is required. The outbox relay is an in-process Spring component. This is significantly simpler to operate than Debezium in the current phase.

**Visibility and debugging:** The `outbox_events` table provides a queryable history of all published events. Support engineers can verify that a specific event was published, when it was published, and what its payload was.

**Decoupled retry logic:** Failed Kafka publishes do not fail the original business operation. The domain entity is saved successfully. The outbox relay retries Kafka publishing independently, with backoff and alerting on repeated failure.

### Negative

**Polling overhead:** The outbox relay polls the database every 100ms. This introduces a small but continuous load on the database. The query is optimized with a partial index on `status = 'PENDING'`, and the polling interval is configurable. In high-volume scenarios, this polling may need tuning.

**Increased latency (microseconds to milliseconds):** Events are not published at the exact moment of commit. They are published when the relay next runs. The typical additional latency is 100-200ms. For the banking platform's use cases (fraud detection in a saga), this latency is within acceptable bounds. Real-time sub-millisecond event delivery is not a requirement.

**At-least-once delivery requires idempotent consumers:** Every Kafka consumer must be written to handle duplicate events correctly. This is a discipline requirement — it must be enforced in code review. Failure to implement idempotency could lead to double-processing (e.g., sending two notification emails for one transaction).

**Outbox table growth:** The outbox table grows continuously and must be purged. A scheduled cleanup job removes PUBLISHED records older than 7 days. This must be monitored to ensure it runs correctly and does not cause table bloat.

**Multiple application instances must coordinate:** If two instances of account-service run simultaneously, both relay instances will poll the outbox. `SELECT ... FOR UPDATE SKIP LOCKED` prevents them from publishing the same event twice, but this pattern must be tested and understood.

**Migration path to CDC:** If we later adopt Debezium for CDC-based outbox reading, the outbox table schema must be compatible with Debezium's expected format. The schema above follows Debezium's recommended outbox table structure to ease future migration.

---

## Implementation Notes

The outbox table schema, `OutboxEvent` JPA entity, `OutboxRelayScheduler`, and `OutboxRepository` are defined as shared library components in the `banking-platform-shared` module and included as a dependency by each service that publishes events. This avoids duplicating the relay implementation across services.

---

## References

- [Microservices Patterns - Chris Richardson: Transactional Outbox](https://microservices.io/patterns/data/transactional-outbox.html)
- [Debezium Outbox Pattern](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html)
- [Gunnar Morling: The Outbox Pattern](https://www.morling.dev/blog/outbox-pattern-with-debezium/)
- ADR-0001: Use Kafka for Asynchronous Communication
- ADR-0002: Saga Orchestration Pattern
- `banking-platform-shared/src/.../outbox/OutboxRelayScheduler.java`

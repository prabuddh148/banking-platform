# Outbox Pattern

## Table of Contents

1. [The Dual-Write Problem](#the-dual-write-problem)
2. [How the Outbox Pattern Solves It](#how-the-outbox-pattern-solves-it)
3. [The outbox_events Table Schema](#the-outbox_events-table-schema)
4. [The Relay Mechanism](#the-relay-mechanism)
5. [Delivery Guarantees and Consumer Requirements](#delivery-guarantees-and-consumer-requirements)
6. [Failure Handling and Retry Policy](#failure-handling-and-retry-policy)
7. [Performance Considerations](#performance-considerations)
8. [Where the Pattern Is Applied](#where-the-pattern-is-applied)
9. [Monitoring and Alerting](#monitoring-and-alerting)
10. [Alternatives Considered](#alternatives-considered)

---

## The Dual-Write Problem

In any system that persists state to a database and publishes events to a message broker, there is a fundamental atomicity problem: the two write operations — the database write and the Kafka publish — cannot be wrapped in a single atomic transaction. They are separate systems with separate durability guarantees.

This creates four possible outcomes for any operation that must do both:

| DB Write | Kafka Publish | Outcome                                                                                   |
|----------|---------------|-------------------------------------------------------------------------------------------|
| Success  | Success       | Consistent — all consumers receive the event                                              |
| Success  | Failure       | **Inconsistent** — state changed in DB but no event emitted; consumers miss the change   |
| Failure  | Success       | **Inconsistent** — event emitted for a change that never actually persisted              |
| Failure  | Failure       | Consistent — nothing happened; operation can be safely retried                           |

The two dangerous cases (rows 2 and 3) are not theoretical. They happen in production:

**DB success, Kafka failure:** The application writes the account row to PostgreSQL but then crashes before the `kafkaTemplate.send()` call is made, or Kafka is temporarily unreachable. The account now exists in the database but `account.created` was never published. Notification-service never sends a welcome message; audit-service never records the creation.

**Kafka success, DB failure:** Less common but possible if the commit to PostgreSQL fails after the Kafka send (e.g., a unique constraint violation discovered at commit time). An event has been published for a domain change that was rolled back.

### Why This Matters in a Banking Context

In a banking platform, missing an event is not a cosmetic problem. Missing `transaction.completed` means audit-service has a gap in the compliance trail. Missing `fraud.detected` means the fraud operations team is not alerted. These are regulatory and operational failures, not just user experience issues.

Naive solutions are inadequate:

- **Try Kafka first, then DB:** If Kafka succeeds but DB fails, you have a phantom event. Rollback of the Kafka publish is not possible.
- **Try DB first, then Kafka:** If DB succeeds but Kafka fails (the common case), you lose the event. A manual retry layer is needed — which is exactly what the outbox provides, but without transactional safety.
- **Use a Kafka transaction spanning DB and Kafka:** Kafka transactional producers provide exactly-once semantics within Kafka, but they do not participate in JDBC transactions. The two systems cannot share a transaction coordinator.

---

## How the Outbox Pattern Solves It

The outbox pattern achieves atomicity by storing the Kafka event as a row in an `outbox_events` table in the **same database** as the business entity being modified. Both writes — the business entity write and the outbox event row — happen inside a single JDBC transaction. If the transaction commits, both are durable. If the transaction rolls back, neither exists.

```
┌─────────────────────────────────────────────────────────────┐
│         Single JDBC Transaction (atomic)                    │
│                                                             │
│  1. INSERT INTO accounts.accounts (...)                     │
│     VALUES (:accountId, :ownerId, :balance, ...)            │
│                                                             │
│  2. INSERT INTO accounts.outbox_events (                    │
│       aggregate_type, aggregate_id, event_type,             │
│       payload, topic, partition_key, status                 │
│     ) VALUES (                                              │
│       'Account', :accountId, 'AccountCreated',             │
│       :payloadJson, 'account.created', :accountId, 'PENDING'│
│     )                                                       │
│                                                             │
│  COMMIT ─────────────────────────────────────────► Both     │
│          or                                         durable  │
│  ROLLBACK ──────────────────────────────────────► Neither   │
│                                                     exists   │
└─────────────────────────────────────────────────────────────┘

           [Separately, OutboxEventRelay polls the table]

┌─────────────────────────────────────────────────────────────┐
│         OutboxEventRelay (scheduled, every 5 seconds)       │
│                                                             │
│  SELECT ... FROM outbox_events WHERE status = 'PENDING'     │
│  LIMIT 100 ORDER BY created_at ASC                          │
│                                                             │
│  For each row:                                              │
│    kafkaTemplate.send(topic, partitionKey, payload)         │
│    UPDATE outbox_events SET status='PUBLISHED',             │
│           published_at=NOW()                                │
│    WHERE id = :id                                           │
└─────────────────────────────────────────────────────────────┘
```

The relay is a separate process from the business logic. It has one job: move PENDING outbox rows to Kafka. If Kafka is temporarily unavailable, rows accumulate in the outbox table. When Kafka recovers, the relay drains the backlog. No events are lost.

---

## The outbox_events Table Schema

Both `account-service` and `transaction-service` maintain an `outbox_events` table within their own PostgreSQL schema.

### DDL

```sql
-- account-service version (identical structure in transactions schema)
CREATE TABLE accounts.outbox_events (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(64)  NOT NULL,
    aggregate_id   VARCHAR(255) NOT NULL,
    event_type     VARCHAR(128) NOT NULL,
    payload        JSONB        NOT NULL,
    topic          VARCHAR(255) NOT NULL,
    partition_key  VARCHAR(255) NOT NULL,
    status         VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
    retry_count    INTEGER      NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    published_at   TIMESTAMPTZ,
    last_error     TEXT,

    CONSTRAINT chk_outbox_status CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED'))
);

-- Partial index for relay polling: only non-terminal rows are ever queried by the relay
CREATE INDEX idx_outbox_events_pending
    ON accounts.outbox_events (created_at ASC)
    WHERE status = 'PENDING';

-- Index for retry job: find FAILED rows eligible for re-attempt
CREATE INDEX idx_outbox_events_failed
    ON accounts.outbox_events (retry_count ASC, created_at ASC)
    WHERE status = 'FAILED';
```

### Field Definitions

| Column          | Type        | Nullable | Description                                                                                          |
|-----------------|-------------|----------|------------------------------------------------------------------------------------------------------|
| `id`            | UUID        | No       | Surrogate primary key. Generated at insert time.                                                    |
| `aggregate_type`| VARCHAR(64) | No       | The type of the domain aggregate (e.g., `Account`, `Transaction`).                                 |
| `aggregate_id`  | VARCHAR(255)| No       | The ID of the specific aggregate instance (e.g., the account UUID).                                |
| `event_type`    | VARCHAR(128)| No       | Discriminator for the event payload schema (e.g., `AccountCreated`, `TransactionCompleted`).        |
| `payload`       | JSONB       | No       | The complete event envelope as a JSON object, including all standard envelope fields and payload.   |
| `topic`         | VARCHAR(255)| No       | The Kafka topic to publish to (e.g., `account.created`).                                            |
| `partition_key` | VARCHAR(255)| No       | The Kafka message key used for partition assignment. Typically `aggregateId`.                       |
| `status`        | VARCHAR(16) | No       | Processing status: `PENDING` (not yet published), `PUBLISHED` (sent to Kafka), `FAILED` (max retries exhausted). |
| `retry_count`   | INTEGER     | No       | Number of publish attempts made. Starts at 0, incremented on each failure. Max 5 before FAILED.    |
| `created_at`    | TIMESTAMPTZ | No       | Timestamp when the outbox row was inserted (within the business transaction).                       |
| `published_at`  | TIMESTAMPTZ | Yes      | Timestamp when the Kafka send was confirmed. NULL until PUBLISHED.                                  |
| `last_error`    | TEXT        | Yes      | The exception message from the most recent failed publish attempt. Used for ops debugging.          |

### Example Outbox Row

```sql
SELECT * FROM accounts.outbox_events WHERE event_type = 'AccountCreated' LIMIT 1;
```

```
id             : 550e8400-e29b-41d4-a716-446655440000
aggregate_type : Account
aggregate_id   : acc_7f3a2b1c-4d5e-6f7a-8b9c-0d1e2f3a4b5c
event_type     : AccountCreated
payload        : {
                   "eventId": "550e8400-e29b-41d4-a716-446655440000",
                   "eventType": "AccountCreated",
                   "aggregateId": "acc_7f3a2b1c-...",
                   "aggregateType": "Account",
                   "correlationId": "req_1a2b3c4d-...",
                   "causationId": null,
                   "sourceService": "account-service",
                   "occurredAt": "2026-06-15T10:30:00.123456Z",
                   "version": 1,
                   "payload": {
                     "accountId": "acc_7f3a2b1c-...",
                     "ownerId": "user_abc123",
                     "accountType": "CHECKING",
                     "currency": "USD",
                     "initialBalance": "0.00",
                     "status": "ACTIVE"
                   }
                 }
topic          : account.created
partition_key  : acc_7f3a2b1c-4d5e-6f7a-8b9c-0d1e2f3a4b5c
status         : PUBLISHED
retry_count    : 0
created_at     : 2026-06-15 10:30:00.123456+00
published_at   : 2026-06-15 10:30:05.201312+00
last_error     : null
```

---

## The Relay Mechanism

The `OutboxEventRelay` is a Spring `@Component` in each service that owns an outbox table. It is responsible for moving PENDING rows from the outbox table to Kafka.

### Implementation

```java
@Component
@RequiredArgsConstructor
@Slf4j
public class OutboxEventRelay {

    private final OutboxEventRepository outboxEventRepository;
    private final KafkaTemplate<String, String> kafkaTemplate;
    private final OutboxEventRepository repository;

    private static final int BATCH_SIZE = 100;
    private static final int MAX_RETRIES = 5;

    @Scheduled(fixedDelay = 5_000)       // runs 5 seconds after last run completes
    @ShedLock(name = "outbox-relay-account-service", lockAtMostFor = "PT4S")
    @Transactional
    public void relay() {
        List<OutboxEvent> pending = repository.findPendingEvents(BATCH_SIZE);

        if (pending.isEmpty()) {
            return;
        }

        log.debug("OutboxEventRelay: processing {} PENDING events", pending.size());

        for (OutboxEvent event : pending) {
            try {
                kafkaTemplate.send(event.getTopic(), event.getPartitionKey(),
                                   event.getPayload())
                    .get(3, TimeUnit.SECONDS);  // synchronous confirm within relay transaction

                event.markPublished();
                repository.save(event);

                log.debug("Published outbox event {} to topic {}", event.getId(), event.getTopic());

            } catch (Exception e) {
                event.incrementRetry(e.getMessage());

                if (event.getRetryCount() >= MAX_RETRIES) {
                    event.markFailed();
                    log.error("Outbox event {} exceeded max retries. Marking FAILED. Last error: {}",
                        event.getId(), e.getMessage());
                } else {
                    log.warn("Outbox event {} failed to publish (attempt {}). Will retry. Error: {}",
                        event.getId(), event.getRetryCount(), e.getMessage());
                }

                repository.save(event);
            }
        }
    }
}
```

### Repository Query

```java
@Query("""
    SELECT e FROM OutboxEvent e
    WHERE e.status = 'PENDING'
    ORDER BY e.createdAt ASC
    LIMIT :limit
    """)
List<OutboxEvent> findPendingEvents(@Param("limit") int limit);
```

The `ORDER BY created_at ASC` ensures events are published in the order they were created, which preserves causal ordering per aggregate (since all events for a given aggregate go to the same Kafka partition via the `partition_key`).

### Relay Timing and Latency

```
Business transaction commits
         │
         │  0 ms — outbox row inserted with status=PENDING
         │
         │  [relay polls every 5 seconds; @fixedDelay means 5s after previous run completes]
         │
         ▼
up to ~5 seconds later — OutboxEventRelay picks up the row
         │
         │  ~10-50 ms — kafkaTemplate.send() call + broker ack
         │
         ▼
Event is available to consumers
```

Maximum expected latency from business transaction commit to Kafka availability: **~5 seconds** under normal conditions. This is acceptable for all current use cases. Notification delivery and audit recording are not time-critical at the sub-second level.

---

## Delivery Guarantees and Consumer Requirements

### At-Least-Once Delivery

The outbox pattern guarantees **at-least-once delivery**. It does NOT guarantee exactly-once delivery. This means consumers will occasionally receive duplicate events in the following scenarios:

1. **Relay crashes after Kafka send but before updating outbox row to PUBLISHED:** The next relay run picks up the same PENDING row and publishes the event a second time.
2. **Database UPDATE to mark PUBLISHED fails:** The Kafka message was delivered but the status update to PUBLISHED rolled back. The event is resent.

Both scenarios are rare but possible. Every consumer in the platform must therefore be idempotent.

### Consumer Idempotency Requirement

Every Kafka consumer in this system must implement idempotency using the `eventId` field from the event envelope:

```java
// Standard idempotency pattern for any consumer
@Transactional
public void process(DomainEvent event) {
    // Check if this eventId has already been processed
    if (processedEventRepository.existsById(event.getEventId())) {
        log.info("Skipping duplicate event {} of type {}", event.getEventId(), event.getEventType());
        return;  // Kafka offset will still be committed
    }

    // Process the event
    doProcess(event);

    // Record that this eventId has been processed
    processedEventRepository.save(new ProcessedEvent(event.getEventId(), Instant.now()));
}
```

Alternative idempotency patterns used per service:

| Service              | Idempotency Mechanism                                                                              |
|----------------------|----------------------------------------------------------------------------------------------------|
| fraud-service        | `ON CONFLICT (transaction_id) DO NOTHING` on fraud_checks insert                                  |
| notification-service | `ON CONFLICT (event_id) DO NOTHING` on notification_log insert                                     |
| audit-service        | `ON CONFLICT (event_id) DO NOTHING` on audit_events insert                                         |
| transaction-service  | Saga state machine check: event is only processed if saga is in the expected preceding state       |

---

## Failure Handling and Retry Policy

### Retry Progression

When a Kafka publish fails (broker unreachable, timeout, serialization error), the relay increments `retry_count` and leaves the row in PENDING status. The next relay run (5 seconds later) retries the publish.

```
Attempt 1: PENDING, retry_count=0 → Failure → retry_count=1, status=PENDING
Attempt 2: PENDING, retry_count=1 → Failure → retry_count=2, status=PENDING
Attempt 3: PENDING, retry_count=2 → Failure → retry_count=3, status=PENDING
Attempt 4: PENDING, retry_count=3 → Failure → retry_count=4, status=PENDING
Attempt 5: PENDING, retry_count=4 → Failure → retry_count=5, status=FAILED
```

After 5 consecutive failures, the row is marked `FAILED`. It is no longer picked up by the main relay. A separate, lower-frequency retry job handles FAILED rows:

```java
@Scheduled(fixedDelay = 60_000)  // retry FAILED rows every 60 seconds
@ShedLock(name = "outbox-failed-retry-account-service", lockAtMostFor = "PT59S")
public void retryFailed() {
    List<OutboxEvent> failed = repository.findFailedEvents(10);  // smaller batch for failed
    failed.forEach(event -> {
        event.resetForRetry();  // reset retry_count to 0, status back to PENDING
        repository.save(event);
    });
    // Main relay will pick these up on the next run
}
```

### Permanent Failure (Dead Letter Queue)

If a row has been in FAILED status for more than 1 hour (i.e., the 60-second retry job is also consistently failing), a Prometheus alert fires and the operations team investigates. Possible causes:
- Kafka broker is permanently offline (infrastructure failure)
- Event payload is malformed and fails Kafka serialization (code defect)
- Topic does not exist (configuration error)

Manual resolution options:
1. Fix the root cause (restore Kafka, fix schema, create topic) and the automatic retry job will clear the backlog.
2. If the payload is permanently unrecoverable, manually update the row to a terminal FAILED state with a note in `last_error` and create a reconciliation ticket.

---

## Performance Considerations

### Polling Overhead

The `SELECT ... WHERE status = 'PENDING' LIMIT 100 ORDER BY created_at ASC` query runs every 5 seconds per service. The partial index on `status = 'PENDING'` ensures this query never scans PUBLISHED rows, which constitute the vast majority of rows over time:

```
Total outbox_events rows over 30 days: ~5,000,000
Rows with status = 'PENDING' at any instant: ~10-50 (under normal load)
Rows scanned by index: 10-50 (not 5,000,000)
```

Without the partial index, the query degrades as the table grows. The partial index keeps the query time constant regardless of table size.

### Batch Size Tuning

The relay processes up to 100 PENDING rows per run. At 5-second intervals, this supports a sustained throughput of 20 events/second per service. Peak throughput (transient bursts) is unlimited because rows accumulate in the table and are drained over successive relay runs.

If sustained throughput consistently exceeds 20 events/second:
1. Reduce `fixedDelay` from 5000 ms to 1000 ms.
2. Increase `BATCH_SIZE` from 100 to 500.
3. Both changes increase relay polling frequency and per-run work; monitor PostgreSQL CPU and Kafka producer latency under load.

### Table Partitioning

Once the `outbox_events` table exceeds ~50 million rows, consider range-partitioning by `created_at` with a monthly partition scheme and dropping partitions older than the Kafka retention window. PUBLISHED rows older than 30 days carry no operational value and can be safely archived.

```sql
-- Example: partition by month
CREATE TABLE accounts.outbox_events_2026_06
    PARTITION OF accounts.outbox_events
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
```

### Kafka Producer Configuration

The relay uses a synchronous send with a 3-second timeout (`kafkaTemplate.send(...).get(3, TimeUnit.SECONDS)`). This ensures that the Kafka broker acknowledgment is confirmed before the outbox row is marked PUBLISHED. The trade-off is that relay throughput is bounded by Kafka producer round-trip latency. For the expected event volume, this is acceptable. If higher throughput is needed, switch to async sends with a completion callback, at the cost of more complex error handling.

```java
// Producer configuration tuned for reliability over latency
@Bean
public ProducerFactory<String, String> producerFactory() {
    Map<String, Object> props = new HashMap<>();
    props.put(ProducerConfig.ACKS_CONFIG, "all");          // wait for all ISR replicas
    props.put(ProducerConfig.RETRIES_CONFIG, 3);
    props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
    props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, 1);
    props.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, 10_000);
    return new DefaultKafkaProducerFactory<>(props);
}
```

`ACKS_CONFIG=all` ensures the message is written to all in-sync replicas before the broker acknowledges the send. Combined with `ENABLE_IDEMPOTENCE_CONFIG=true`, this prevents duplicate Kafka messages from producer retries.

---

## Where the Pattern Is Applied

The outbox pattern is implemented in two services: **account-service** and **transaction-service**. These are the only services that both write to a database AND need to produce Kafka events in the same business operation.

| Service             | outbox_events Schema | Events Produced via Outbox                                                       |
|---------------------|---------------------|---------------------------------------------------------------------------------|
| account-service     | `accounts`          | `account.created`, `account.status.changed`                                     |
| transaction-service | `transactions`      | `transaction.initiated`, `transaction.processing`, `transaction.completed`, `transaction.failed` |

### Services That Do NOT Use the Outbox Pattern

- **fraud-service:** Produces `fraud.decision` and `fraud.detected`. These events are produced in response to consuming `transaction.initiated`. If the Kafka publish fails, the consumer retry mechanism replays the input event, triggering fraud re-evaluation and a new attempt to produce the output. The input Kafka event acts as the durability anchor; no outbox is needed.
- **notification-service:** Does not produce Kafka events.
- **audit-service:** Does not produce Kafka events.
- **api-gateway:** Does not produce Kafka events.

### Outbox Module Location in Maven Structure

```
banking-platform/
├── account-service/
│   └── src/main/java/com/banking/account/
│       └── outbox/
│           ├── OutboxEvent.java
│           ├── OutboxEventRepository.java
│           └── OutboxEventRelay.java
│
└── transaction-service/
    └── src/main/java/com/banking/transaction/
        └── outbox/
            ├── OutboxEvent.java
            ├── OutboxEventRepository.java
            └── OutboxEventRelay.java
```

Both implementations are structurally identical. A future improvement could extract the outbox module into a shared Maven library (`banking-outbox-starter`) to avoid duplication, but the current inline approach keeps each service self-contained and avoids a shared-library dependency that would couple deployment timelines.

---

## Monitoring and Alerting

### Key Metrics

The `OutboxEventRelay` and `OutboxEvent` entity expose the following Prometheus metrics via Micrometer:

```
# Queue depth: number of PENDING rows (gauge, polled every 30s)
banking_outbox_pending_count{service="account-service"} 2
banking_outbox_pending_count{service="transaction-service"} 5

# Failed rows: number of rows in FAILED status (gauge)
banking_outbox_failed_count{service="account-service"} 0
banking_outbox_failed_count{service="transaction-service"} 0

# Relay run duration (histogram, seconds)
banking_outbox_relay_duration_seconds_bucket{service="account-service", le="0.1"} 1440
banking_outbox_relay_duration_seconds_bucket{service="account-service", le="1.0"} 1440

# Events published per relay run (counter)
banking_outbox_events_published_total{service="account-service"} 48321
banking_outbox_events_published_total{service="transaction-service"} 14247

# Relay failures (counter)
banking_outbox_relay_failures_total{service="account-service"} 0
```

### Grafana Alert Rules

| Alert Name                   | Condition                                                               | Severity | Action                                              |
|------------------------------|-------------------------------------------------------------------------|----------|-----------------------------------------------------|
| OutboxQueueDepthHigh         | `banking_outbox_pending_count > 1000` for 2 minutes                   | Warning  | Check Kafka broker health and producer error rate   |
| OutboxQueueDepthCritical     | `banking_outbox_pending_count > 5000` for 5 minutes                   | Critical | Kafka may be down; check broker and relay logs      |
| OutboxFailedRowsNonZero      | `banking_outbox_failed_count > 0` for 5 minutes                       | Warning  | Investigate FAILED rows; check `last_error` column  |
| OutboxFailedRowsHigh         | `banking_outbox_failed_count > 10`                                     | Critical | Multiple events permanently stuck; immediate action  |
| OutboxRelayNotRunning        | No `banking_outbox_relay_duration_seconds` sample for 60 seconds       | Critical | Relay scheduled job has stopped running             |

### Operational Queries

**Check current outbox state:**
```sql
SELECT
    status,
    COUNT(*) as count,
    MIN(created_at) as oldest,
    MAX(retry_count) as max_retries
FROM accounts.outbox_events
GROUP BY status;
```

**Inspect FAILED rows:**
```sql
SELECT id, event_type, aggregate_id, retry_count, last_error, created_at
FROM accounts.outbox_events
WHERE status = 'FAILED'
ORDER BY created_at ASC;
```

**Check average outbox lag (time from creation to publish):**
```sql
SELECT
    AVG(EXTRACT(EPOCH FROM (published_at - created_at))) AS avg_lag_seconds,
    MAX(EXTRACT(EPOCH FROM (published_at - created_at))) AS max_lag_seconds,
    PERCENTILE_CONT(0.99) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (published_at - created_at))
    ) AS p99_lag_seconds
FROM accounts.outbox_events
WHERE status = 'PUBLISHED'
  AND published_at > NOW() - INTERVAL '1 hour';
```

Normal expected values: `avg_lag_seconds` ≈ 2-5 seconds, `p99_lag_seconds` < 10 seconds. Values consistently above 30 seconds indicate relay degradation.

---

## Alternatives Considered

### Debezium Change Data Capture (CDC)

Debezium is a log-mining tool that reads the PostgreSQL WAL (Write-Ahead Log) and publishes change events to Kafka. It eliminates the relay polling loop and provides sub-second latency.

**Why it was deferred:**

1. **Operational complexity:** Debezium requires configuring PostgreSQL for logical replication (`wal_level=logical`), deploying and operating a Kafka Connect cluster, and managing Debezium connector configurations. This is significant additional infrastructure for a platform that is still establishing its baseline.
2. **WAL slot management:** If the Debezium connector falls behind, the WAL slot prevents PostgreSQL from cleaning up old WAL segments. This can cause disk exhaustion on the database server — a production risk that requires careful monitoring.
3. **Schema change sensitivity:** Debezium connectors are sensitive to table schema changes. A column rename or type change can require connector restart and schema mapping updates. Flyway migrations must be coordinated with Debezium configuration.

Debezium remains the preferred long-term upgrade path once the operational team has capacity to manage it. The outbox table schema is already compatible with Debezium's expected structure.

### Database Triggers for Outbox Population

An alternative to writing outbox rows from application code is to use a PostgreSQL trigger: after any INSERT/UPDATE on the business table, the trigger automatically inserts an outbox row.

**Why it was rejected:**

1. **Logic in the database:** Business logic (what event to generate, what payload to include) would live in PL/pgSQL trigger functions rather than Java code. This makes the event payload construction harder to test, version, and review.
2. **Trigger debugging difficulty:** Trigger failures surface as cryptic database errors. Debugging a failing trigger requires database-level access that application developers may not have in production.
3. **Lack of application context:** Triggers cannot access the HTTP request context (correlationId, causationId, authenticated user) that needs to be embedded in the event envelope. The application code has this context naturally.
4. **Schema coupling:** Triggers couple the outbox logic to the exact table structure. Any schema change to the business table requires updating the trigger.

The application-level outbox write (inside the service layer `@Transactional` method) is more maintainable, testable, and transparent.

### Kafka Transactions (Exactly-Once)

Kafka's transactional producer API can provide exactly-once delivery within the Kafka ecosystem. Combined with a transactional consumer (read-process-write in a Kafka Streams topology), it can guarantee exactly-once end-to-end semantics between Kafka topics.

**Why it was not used for the primary write path:**

Kafka transactions cannot include a JDBC database write. The atomic guarantee only spans Kafka producer operations (multi-partition sends and consumer offset commits). The fundamental problem — atomically persisting a domain entity to PostgreSQL and publishing a Kafka event — is not solved by Kafka transactions alone.

Kafka's `ENABLE_IDEMPOTENCE_CONFIG=true` IS used on the relay's Kafka producer to prevent duplicate Kafka messages from producer retries. This is a narrower guarantee (idempotent sends, not transactional writes) and is compatible with the outbox approach.

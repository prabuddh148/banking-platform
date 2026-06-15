# Kafka Topic Design — Banking Platform

**Platform:** Java 21 / Spring Boot 3.2.5 / Apache Kafka (KRaft) / PostgreSQL 16
**Last Updated:** 2026-06-15
**Maintainer:** Platform Engineering

---

## Table of Contents

1. [Overview](#1-overview)
2. [Topic Naming Convention](#2-topic-naming-convention)
3. [Partition Count Rationale](#3-partition-count-rationale)
4. [Replication Factor](#4-replication-factor)
5. [Partition Key Strategy](#5-partition-key-strategy)
6. [Retention Policy Decisions](#6-retention-policy-decisions)
7. [Log Compaction](#7-log-compaction)
8. [Producer Configuration](#8-producer-configuration)
9. [Consumer Configuration](#9-consumer-configuration)
10. [Consumer Group Strategy](#10-consumer-group-strategy)
11. [Full Topic Inventory](#11-full-topic-inventory)
12. [Capacity Planning](#12-capacity-planning)
13. [Kafka Cluster Configuration (Production)](#13-kafka-cluster-configuration-production)

---

## 1. Overview

### Why Kafka for This Banking Platform

Apache Kafka serves as the central nervous system of this banking platform's event-driven architecture. In a financial context, the ability to decouple services, guarantee message delivery, and replay event history is not a nice-to-have -- it is an architectural requirement.

**Core reasons for choosing Kafka over alternatives (RabbitMQ, SQS, etc.):**

- **Durability and Replay:** Kafka retains messages on disk for a configurable period. If the fraud service is redeployed mid-day, it can resume from its last committed offset and process every `transaction.initiated` event it missed, with no messages lost.
- **Ordered Partitions:** Within a single partition, messages are strictly ordered. By using `sourceAccountId` as the key for `transaction.initiated`, all outgoing transactions from a given account are processed in sequence, preventing double-spend race conditions.
- **Fan-out Without Coupling:** A single `transaction.completed` event is consumed independently by `account-service`, `notification-service`, and `audit-service`. Adding a new consumer (e.g., a rewards service) requires zero changes to the producer.
- **Back-pressure and Throughput:** Kafka brokers and partitions horizontally scale throughput. Transaction topics use 12 partitions to support parallel processing across 12 consumer instances at peak load.
- **Audit Trail:** Kafka's immutable log is a natural audit trail. The `fraud.detected` topic is retained for 90 days to satisfy regulatory requirements without needing a separate archival pipeline.
- **Saga Orchestration:** The `transaction.processing` topic supports the Saga pattern for multi-step distributed transactions. The transaction service acts as both producer and consumer of this topic to coordinate compensating actions.

### Event-Driven Architecture Benefits

| Benefit | How It Applies Here |
|---|---|
| Loose coupling | `account-service` publishes `account.created`; it does not call notification or audit services directly |
| Resilience | If `notification-service` is down, events queue in Kafka; no data loss, no cascading failure |
| Scalability | Add consumer instances to scale processing without touching producers |
| Observability | Every state change produces a durable event; reconstruct system state from the log |
| Compliance | Immutable event log simplifies audit and forensic investigation |

---

## 2. Topic Naming Convention

### Format

```
{domain}.{event}
```

**Examples:**

- `account.created`
- `transaction.completed`
- `fraud.detected`
- `notification.requested`

### Dead Letter Topic (DLT) Naming

```
{original-topic}.DLT
```

**Examples:**

- `transaction.initiated.DLT`
- `fraud.decision.DLT`
- `account.created.DLT`

Spring Kafka's `@RetryableTopic` annotation automatically routes non-retryable or exhausted-retry messages to the `.DLT` suffix topic. DLT topics share the same namespace to make monitoring straightforward -- a single alert on topics matching `*.DLT` covers all dead letter queues.

### Naming Rules

| Rule | Rationale |
|---|---|
| All lowercase | Kafka topic names are case-sensitive; enforcing lowercase prevents `Transaction.Completed` vs `transaction.completed` mismatches |
| Dots (`.`) as separators | Standard convention; dots separate domain from event cleanly |
| No underscores | Underscores are visually ambiguous with dots in monitoring dashboards |
| No camelCase | `transactionCompleted` vs `transaction.completed` -- the latter reads as structured hierarchy |
| No version suffixes in name | Version changes that break schema compatibility use a separate topic; non-breaking changes are handled via schema evolution in Avro/JSON Schema |

### Active Domain Prefixes

| Prefix | Owner Service | Represents |
|---|---|---|
| `account` | account-service | Account lifecycle events |
| `transaction` | transaction-service | Payment and transfer events |
| `fraud` | fraud-service | Fraud analysis decisions and alerts |
| `notification` | any service (request), notification-service (consume) | Outbound communication requests |

---

## 3. Partition Count Rationale

### Transaction Topics: 12 Partitions

Transaction topics (`transaction.initiated`, `transaction.processing`, `transaction.completed`, `transaction.failed`, `fraud.decision`) are assigned 12 partitions based on the following throughput projection:

**Volume Estimate:**

- 100,000 transactions/day at peak
- Average TPS: 100,000 / 86,400 = ~1.16 TPS (baseline)
- Peak TPS (assume 6x morning/evening spike): ~7 TPS
- Burst ceiling for capacity headroom: ~70 TPS

**Parallelism Requirement:**

Each partition can be consumed by exactly one consumer instance within a consumer group. To sustain 70 TPS peak with adequate headroom:

- `fraud-service` needs to evaluate transactions within SLA (~500ms)
- Running 12 fraud-service instances in parallel across 12 partitions allows the group to process ~70 events/second with room to spare
- 12 partitions also leaves 4x headroom over the projected 3 concurrent consumer instances at steady state, accommodating future volume growth without repartitioning

**The rule applied:** `partitions >= max planned consumer instances in the consumer group`

### Account / Fraud Alert / Notification Topics: 6 Partitions

Topics `account.created`, `account.status.changed`, `fraud.detected`, `notification.requested` use 6 partitions because:

- **Account creation** is low-frequency: estimated 1,000-5,000 accounts/day. Even 3 consumer instances is generous; 6 partitions provides 2x headroom.
- **fraud.detected** is an alert topic, not a high-throughput stream. Fraud decisions are already made on `fraud.decision`; this topic triggers human review and notifications.
- **notification.requested** consumers are I/O-bound (email/SMS API calls), not CPU-bound. 6 partitions supports 6 concurrent notification workers, which is sufficient for the projected notification volume.
- Max consumer group size for these topics is bounded to 6 instances by business logic, not infrastructure limits.

### Future Scaling Considerations

Kafka allows increasing partition count at any time via:

```bash
kafka-topics.sh --alter --topic transaction.initiated --partitions 24 --bootstrap-server localhost:9092
```

**Warning:** Increasing partition count breaks the ordering guarantee for existing keys. If `sourceAccountId=ABC123` was previously hashed to partition 3, it will be hashed to a different partition after repartitioning. Any in-flight messages will arrive out of order relative to new messages for the same key. Plan repartitioning during maintenance windows with consumer group lag at zero.

---

## 4. Replication Factor

### Production: Replication Factor = 3

```properties
# Topic-level setting applied at creation
replication.factor=3
min.insync.replicas=2
```

**Why 3 replicas:**

- Tolerates loss of 1 broker with no data loss and no producer errors
- With `acks=all`, the leader waits for `min.insync.replicas` (2) before acknowledging the write. This means 2 brokers must confirm receipt before the producer receives success
- If 1 broker fails, the remaining 2 still satisfy `min.insync.replicas=2` and writes continue uninterrupted
- If 2 brokers fail simultaneously, the cluster becomes read-only (writes fail with `NotEnoughReplicasException`) -- acceptable for a 3-broker cluster where 2-broker simultaneous failure is an extreme event

**Availability model:**

| Brokers Lost | Writes | Reads |
|---|---|---|
| 0 | OK | OK |
| 1 | OK (2 ISR still meet min.insync=2) | OK |
| 2 | BLOCKED (only 1 ISR, below min.insync=2) | OK (1 remaining broker) |
| 3 | UNAVAILABLE | UNAVAILABLE |

### Development: Replication Factor = 1

```properties
replication.factor=1
```

Single-node Kafka in development environments (Docker Compose, local KRaft) does not need redundancy. Using `replication.factor=3` on a single broker causes topic creation to fail. Development profiles set this explicitly via Spring Boot's `spring.kafka.admin.properties` to avoid misconfiguration.

---

## 5. Partition Key Strategy

The partition key determines which partition a message lands on via `murmur2(key) % numPartitions`. Choosing the wrong key causes hot partitions, ordering violations, or broken consumer SLAs. The following decisions are intentional:

### `account.created` -> Key: `customerId`

A customer may open multiple accounts (checking, savings, credit). Using `customerId` as the key groups all account creation events for the same customer onto the same partition. This allows downstream consumers (audit-service) to reconstruct the customer's full account history in order, even across multiple account IDs.

### `account.status.changed` -> Key: `accountId`

Account status transitions (ACTIVE -> FROZEN -> CLOSED) must be processed in order per account. Using `accountId` ensures all status changes for a given account land on the same partition. `transaction-service` subscribes to this topic and must not process a debit against an account that is concurrently being frozen; strict partition ordering prevents this race.

### `transaction.initiated` -> Key: `sourceAccountId`

All outgoing transactions from the same account are sequenced together. This is critical for fraud detection: the fraud service sees transactions from account A in the order they were initiated. Without this, a rapid sequence of 10 transactions from the same account could arrive at fraud-service out of order across different partitions, defeating velocity-check rules.

### `transaction.processing` -> Key: `transactionId`

Each transaction's saga steps (INITIATED -> DEBIT_PENDING -> CREDIT_PENDING -> COMPLETED) must execute in strict order. Using `transactionId` ensures all saga messages for a single transaction flow through one partition and are consumed sequentially by the transaction-service saga consumer. This is the cornerstone of the Saga pattern correctness guarantee.

### `transaction.completed` -> Key: `transactionId`

Completion events must be correlated back to the original transaction. Using `transactionId` as key ensures that `account-service`, `notification-service`, and `audit-service` all process completion in the context of the correct transaction, and any compensating event (a subsequent `transaction.failed` for the same ID in an error path) arrives on the same partition.

### `transaction.failed` -> Key: `transactionId`

Same reasoning as `transaction.completed`. Failure and completion events share the same key scheme so that consumers can correlate them by partition without additional lookups.

### `fraud.decision` -> Key: `transactionId`

The fraud service publishes its APPROVE/REJECT decision keyed by `transactionId`. The `transaction-service` consumer uses this to unblock or cancel the saga. Note that `transaction.initiated` uses `sourceAccountId` as key, so `fraud.decision` and `transaction.initiated` events for the same transaction will NOT necessarily land on the same partition. This is expected -- `transaction-service` correlates by `transactionId` in its in-memory saga state or database, not by partition co-location.

### `fraud.detected` -> Key: `accountId`

When fraud is confirmed on an account, all fraud alert events for that account should be co-located. `audit-service` subscribes and builds a per-account fraud history. Keying by `accountId` ensures this history is reconstructible in partition order.

### `notification.requested` -> Key: `recipientId`

Rate limiting and deduplication logic in `notification-service` operates per recipient. By keying on `recipientId`, all notification requests for the same user land on the same partition and are processed by the same consumer instance. This makes per-recipient rate limiting (e.g., max 3 SMS/hour) implementable without distributed state -- the consumer instance owns all requests for that recipient within its assigned partitions.

---

## 6. Retention Policy Decisions

Retention is configured per-topic via `retention.ms`. The values below reflect a balance between operational replay requirements, compliance obligations, and storage cost.

### 3 Days -- `transaction.processing`, `notification.requested`

```properties
retention.ms=259200000  # 3 days
```

- **transaction.processing:** Saga state is short-lived. A transaction either completes or fails within minutes. The saga state is also persisted in PostgreSQL, so Kafka is a coordination mechanism, not the source of truth. 3 days provides ample replay window for a failed saga consumer.
- **notification.requested:** Notifications are fire-and-forget. A 3-day-old notification request (e.g., "OTP code: 123456") is irrelevant -- the OTP has expired. Retaining longer wastes storage without business value.

### 7 Days -- `account.created`, `transaction.initiated`, `fraud.decision`

```properties
retention.ms=604800000  # 7 days
```

- **account.created:** Account creation events are operational. If the audit service falls behind, 7 days provides a full week to catch up without data loss. Beyond 7 days, the account record is authoritative in PostgreSQL.
- **transaction.initiated:** The start-of-funnel event for every transaction. 7 days covers any reasonable service outage recovery window. Fraud models that need longer history read from the data warehouse, not Kafka.
- **fraud.decision:** Decisions must be consumable by `transaction-service` even after a multi-day outage. 7 days is generous for a decision that has a sub-second SLA under normal operations.

### 30 Days -- `account.status.changed`, `transaction.completed`, `transaction.failed`

```properties
retention.ms=2592000000  # 30 days
```

- **account.status.changed:** Status changes have compliance implications. A 30-day retention window supports end-of-month reconciliation and provides an event trail for account freeze/unfreeze disputes.
- **transaction.completed / transaction.failed:** These are the terminal state events for every financial transaction. 30 days aligns with monthly statement cycles and supports charge-back investigation windows (most card networks allow 30-45 days for dispute initiation).

### 90 Days -- `fraud.detected`

```properties
retention.ms=7776000000  # 90 days
```

- Regulatory requirement. Fraud alerts must be retained in an auditable, replayable log for at least 90 days to support financial crime investigations and regulatory reporting (e.g., SAR filings). This topic feeds directly into the compliance audit pipeline.
- Note: For jurisdictions requiring longer retention (e.g., 7 years under AML regulations), events from this topic should be archived to cold storage (S3 Glacier, Azure Archive) via a Kafka Connect sink connector.

---

## 7. Log Compaction

**Log compaction is NOT used for any topic in this system.**

All topics use the `delete` cleanup policy (time-based expiry).

```properties
cleanup.policy=delete
```

### Why Not Compaction

Log compaction retains only the most recent message per key, deleting older messages with the same key. This is appropriate for **state stores** (e.g., "current account balance per accountId"), not **event streams**.

Every event in this system is an immutable fact:

- `transaction.completed` at 09:00 and `transaction.completed` at 11:00 for the same `transactionId` are two different facts about two different transactions (or an error condition -- both must be retained for investigation).
- Compacting `account.status.changed` would lose the intermediate states (ACTIVE -> FROZEN -> ACTIVE -> CLOSED), which are exactly the audit trail that compliance requires.

### When Compaction Would Be Appropriate

If the platform introduced a `account.balance.snapshot` topic -- where each message represents the current balance of an account and older snapshots are superseded -- compaction would be correct. The key would be `accountId` and consumers would only ever need the latest value.

For this platform, such state is owned by PostgreSQL, not Kafka.

---

## 8. Producer Configuration

All services use a shared Spring Kafka producer configuration. The following properties are set in `application.yml` under `spring.kafka.producer`:

```properties
# Durability and exactly-once semantics
acks=all
enable.idempotence=true
retries=3
max.in.flight.requests.per.connection=1

# Throughput tuning
compression.type=snappy
linger.ms=5
batch.size=16384
```

### Setting Explanations

**`acks=all`**
The producer waits for acknowledgment from all in-sync replicas (ISR), not just the leader. Combined with `min.insync.replicas=2`, this guarantees a message is durable on at least 2 brokers before the producer considers the send successful. In a banking context, an unacknowledged write that the leader later loses during a crash is unacceptable.

**`enable.idempotence=true`**
Prevents duplicate messages on producer retry. If the broker receives a message, acknowledges it, but the network drops the ack before the producer receives it, the producer retries. Without idempotence, this creates a duplicate. With idempotence, Kafka deduplicates using the producer ID and sequence number. This is a prerequisite for exactly-once semantics. Enabling idempotence automatically enforces `acks=all` and `max.in.flight.requests.per.connection <= 5`.

**`retries=3`**
On transient broker errors (leader election, network blip), retry up to 3 times before propagating the exception to the application. Combined with idempotence, retries are safe. The application-level exception handler (publishing to DLT) only fires after all retries are exhausted.

**`max.in.flight.requests.per.connection=1`**
Restricts the producer to one unacknowledged request at a time per broker connection. Without this, if request 1 fails and request 2 succeeds before request 1 is retried, messages arrive out of order on the broker. Setting this to 1 enforces strict ordering at the cost of some throughput. With `enable.idempotence=true`, Kafka supports up to 5 in-flight requests while maintaining ordering -- but we set 1 for maximum safety in financial transactions.

**`compression.type=snappy`**
Compresses message batches before sending to the broker. Snappy provides a good balance of compression ratio (~40-50% size reduction for JSON payloads) and CPU overhead (faster than gzip, better compression than lz4). Reduces network bandwidth and broker disk usage significantly for high-volume transaction topics.

**`linger.ms=5`**
The producer waits up to 5ms after the first message in a batch before sending, allowing more messages to accumulate in the same batch. At 7 TPS average, this means batches of ~35 messages, improving compression efficiency and reducing per-message network overhead. 5ms adds negligible latency for an asynchronous event pipeline.

**`batch.size=16384`**
Maximum batch size in bytes (16KB). The producer sends a batch when either `linger.ms` expires or the batch reaches this size. 16KB is the Kafka default and appropriate for 1KB average message sizes (fits ~16 messages per batch). Increase to 32768 if average message sizes grow.

---

## 9. Consumer Configuration

All services use a shared Spring Kafka consumer configuration:

```properties
# Offset management
auto.offset.reset=earliest
enable.auto.commit=false

# Throughput and reliability
max.poll.records=500
session.timeout.ms=30000
heartbeat.interval.ms=10000
```

### Setting Explanations

**`auto.offset.reset=earliest`**
When a consumer group has no committed offset (first startup, or offset expired due to retention), start from the beginning of the topic (earliest available message). In a banking platform, missing events is worse than reprocessing them. `latest` would cause newly deployed services to silently skip all events that arrived during their first startup, which is unacceptable for audit-service and fraud-service.

**`enable.auto.commit=false`**
Kafka must not automatically commit offsets. Spring Kafka's `@KafkaListener` with `AckMode.RECORD` or `AckMode.BATCH` commits offsets only after the listener method returns successfully. If message processing fails (database error, external API failure), the offset is not committed and the message is redelivered. Auto-commit would advance the offset even if processing threw an exception, causing silent data loss.

**`max.poll.records=500`**
The maximum number of records returned in a single `poll()` call. Spring Kafka processes these records and must call `poll()` again within `max.poll.interval.ms` (default 5 minutes). 500 records at ~1KB each = 500KB per poll batch. This is appropriate for services that process records quickly. For `fraud-service`, which calls an ML scoring endpoint per transaction, reduce this to 50-100 to avoid `max.poll.interval.ms` violations during scoring delays.

**`session.timeout.ms=30000`**
If the consumer does not send a heartbeat to the group coordinator within 30 seconds, it is considered dead and a partition rebalance is triggered. 30 seconds is generous for JVM-based services; it prevents spurious rebalances during GC pauses or brief network blips.

**`heartbeat.interval.ms=10000`**
The consumer sends heartbeats every 10 seconds. This must be less than `session.timeout.ms / 3` (30,000 / 3 = 10,000). Set exactly at the boundary: 3 missed heartbeats trigger session timeout. This gives the coordinator 3 chances to detect a failed consumer before declaring it dead.

### Spring Kafka Offset Commit Behavior

With `enable.auto.commit=false`, Spring Kafka manages offsets via `AcknowledgingMessageListener`. The commit happens:

1. After the `@KafkaListener` method returns without throwing
2. In batch mode: after the entire batch is processed
3. On failure: the offset is NOT committed; the record is eligible for retry via `@RetryableTopic`

After `retries` are exhausted, the message is routed to the `.DLT` topic and the original topic offset is committed (to avoid blocking the partition indefinitely).

---

## 10. Consumer Group Strategy

### Design Principle

**One consumer group per service.** Each service maintains independent offset tracking. This means:

- `notification-service` and `audit-service` both subscribe to `transaction.completed`, but each maintains its own offset. Notification processing lag does not affect audit processing, and vice versa.
- Multiple instances of the same service (e.g., 3 instances of `transaction-service`) join the same consumer group (`transaction-service-group`) and share partitions among themselves.

### Horizontal Scaling

Adding instances to a consumer group increases parallelism up to the number of partitions:

- `transaction.initiated` has 12 partitions -> max 12 `fraud-service` instances can consume in parallel
- Deploying a 13th instance leaves it idle (no partitions to assign)
- Scale down from 12 to 6 instances -> each instance takes 2 partitions

### Consumer Group to Topic Mapping

| Service | Consumer Group | Topics Subscribed |
|---|---|---|
| account-service | `account-service-group` | `transaction.completed`, `transaction.failed`, `account.status.changed` |
| transaction-service | `transaction-service-group` | `account.status.changed`, `transaction.processing`, `fraud.decision` |
| fraud-service | `fraud-service-group` | `transaction.initiated` |
| notification-service | `notification-service-group` | `account.created`, `account.status.changed`, `transaction.completed`, `transaction.failed`, `fraud.detected`, `notification.requested` |
| audit-service | `audit-service-group` | `account.created`, `account.status.changed`, `transaction.initiated`, `transaction.completed`, `transaction.failed`, `fraud.detected` |

### Partition Assignment Strategy

**Default: `RangeAssignor`**
Assigns contiguous ranges of partitions to consumers. Simple but can cause uneven distribution when partition counts are not evenly divisible by consumer count (e.g., 12 partitions across 5 consumers -> two consumers get 3 partitions, three get 2).

**Recommended for Production: `CooperativeStickyAssignor`**

```properties
partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssignor
```

- **Cooperative rebalancing:** During a rebalance, only the partitions that need to move are revoked. Consumers keep processing their other partitions. This eliminates the "stop-the-world" rebalance pause.
- **Sticky:** Minimizes partition movement between rebalances -- consumers tend to keep the same partitions across restarts, which is valuable if per-partition in-memory state is maintained (e.g., fraud rate limiting counters).
- Particularly important for `transaction-service` where a full rebalance pause during peak transaction volume is problematic.

---

## 11. Full Topic Inventory

### Main Topics

| Topic | Partitions | Replication (Prod) | Retention | Partition Key | Cleanup Policy | DLT Topic |
|---|---|---|---|---|---|---|
| `account.created` | 6 | 3 | 7 days | `customerId` | delete | `account.created.DLT` |
| `account.status.changed` | 6 | 3 | 30 days | `accountId` | delete | `account.status.changed.DLT` |
| `transaction.initiated` | 12 | 3 | 7 days | `sourceAccountId` | delete | `transaction.initiated.DLT` |
| `transaction.processing` | 12 | 3 | 3 days | `transactionId` | delete | `transaction.processing.DLT` |
| `transaction.completed` | 12 | 3 | 30 days | `transactionId` | delete | `transaction.completed.DLT` |
| `transaction.failed` | 12 | 3 | 30 days | `transactionId` | delete | `transaction.failed.DLT` |
| `fraud.decision` | 12 | 3 | 7 days | `transactionId` | delete | `fraud.decision.DLT` |
| `fraud.detected` | 6 | 3 | 90 days | `accountId` | delete | `fraud.detected.DLT` |
| `notification.requested` | 6 | 3 | 3 days | `recipientId` | delete | `notification.requested.DLT` |

### Dead Letter Topics (DLT)

| DLT Topic | Partitions | Replication (Prod) | Retention | Notes |
|---|---|---|---|---|
| `account.created.DLT` | 6 | 3 | 30 days | Manual review + replay |
| `account.status.changed.DLT` | 6 | 3 | 30 days | Manual review + replay |
| `transaction.initiated.DLT` | 6 | 3 | 30 days | Alert on-call; fraud SLA breached |
| `transaction.processing.DLT` | 6 | 3 | 30 days | Saga compensation required |
| `transaction.completed.DLT` | 6 | 3 | 30 days | Reconciliation required |
| `transaction.failed.DLT` | 6 | 3 | 30 days | Reconciliation required |
| `fraud.decision.DLT` | 6 | 3 | 30 days | Transaction blocked; manual unblock |
| `fraud.detected.DLT` | 6 | 3 | 30 days | Compliance notification blocked |
| `notification.requested.DLT` | 6 | 3 | 30 days | Notification silently failed; alert |

**DLT Monitoring:** All DLT topics should trigger a PagerDuty alert when consumer lag exceeds 0 (i.e., any message lands in a DLT). A message in a financial DLT always warrants investigation.

---

## 12. Capacity Planning

### Message Volume Estimates

| Topic | Est. Messages/Day | Avg Message Size | Daily Volume (uncompressed) | Replication Factor | Daily Storage (replicated) |
|---|---|---|---|---|---|
| `account.created` | 1,000 | 1.2 KB | 1.2 MB | 3 | 3.6 MB |
| `account.status.changed` | 500 | 0.8 KB | 0.4 MB | 3 | 1.2 MB |
| `transaction.initiated` | 100,000 | 1.5 KB | 150 MB | 3 | 450 MB |
| `transaction.processing` | 300,000 | 0.8 KB | 240 MB | 3 | 720 MB |
| `transaction.completed` | 85,000 | 2.0 KB | 170 MB | 3 | 510 MB |
| `transaction.failed` | 15,000 | 1.5 KB | 22.5 MB | 3 | 67.5 MB |
| `fraud.decision` | 100,000 | 0.6 KB | 60 MB | 3 | 180 MB |
| `fraud.detected` | 500 | 2.0 KB | 1.0 MB | 3 | 3.0 MB |
| `notification.requested` | 200,000 | 0.5 KB | 100 MB | 3 | 300 MB |
| **All DLT Topics (combined)** | ~500 | 1.0 KB | 0.5 MB | 3 | 1.5 MB |

> Note: `transaction.processing` volume is ~3x `transaction.initiated` because each transaction produces approximately 3 saga step messages (DEBIT_PENDING, CREDIT_PENDING, COMPLETED/FAILED).
> Compression with Snappy reduces on-wire and on-disk size by approximately 40-50%. Storage estimates below use compressed sizes.

### Daily Storage Summary (Compressed at 50% ratio)

| Category | Uncompressed Daily | Compressed Daily |
|---|---|---|
| Account topics | 4.8 MB | 2.4 MB |
| Transaction topics | 582.5 MB | 291 MB |
| Fraud topics | 61 MB | 30.5 MB |
| Notification topics | 100 MB | 50 MB |
| DLT topics | 0.5 MB | 0.25 MB |
| **Total** | **~748 MB/day** | **~374 MB/day** |

### 30-Day Storage Projection

Applying retention periods to calculate peak stored data:

| Topic | Retention | Daily Storage (compressed) | Peak Stored |
|---|---|---|---|
| `account.created` | 7 days | 1.8 MB | 12.6 MB |
| `account.status.changed` | 30 days | 0.6 MB | 18 MB |
| `transaction.initiated` | 7 days | 225 MB | 1,575 MB |
| `transaction.processing` | 3 days | 360 MB | 1,080 MB |
| `transaction.completed` | 30 days | 255 MB | 7,650 MB |
| `transaction.failed` | 30 days | 33.75 MB | 1,012 MB |
| `fraud.decision` | 7 days | 90 MB | 630 MB |
| `fraud.detected` | 90 days | 1.5 MB | 135 MB |
| `notification.requested` | 3 days | 150 MB | 450 MB |
| DLT (all, 30 days) | 30 days | 0.75 MB | 22.5 MB |
| **Total** | | | **~12.6 GB** |

**Cluster Storage Allocation:** Provision at least **20 GB per broker** for Kafka log storage (accounting for growth headroom and index files). A 3-broker cluster should provision **60 GB total** for Kafka data, separate from OS and application storage.

### Throughput Capacity

At peak (70 TPS on transaction topics):
- Ingress: 70 events/sec x 1.5 KB = ~105 KB/sec uncompressed producer throughput
- With replication: 105 KB/sec x 3 = ~315 KB/sec broker write throughput
- This is well within single-broker capabilities (Kafka brokers typically sustain 100+ MB/sec)

---

## 13. Kafka Cluster Configuration (Production)

### Minimum Cluster Topology

| Component | Count | Notes |
|---|---|---|
| Kafka Brokers | 3 | Minimum for `replication.factor=3` and `min.insync.replicas=2` |
| KRaft Controllers | 3 | Can be co-located with brokers for clusters < 10 nodes |
| ZooKeeper | 0 | Not required -- KRaft mode eliminates ZooKeeper dependency |

### KRaft Mode (Recommended)

Apache Kafka 3.x supports KRaft (Kafka Raft) mode, eliminating the ZooKeeper dependency. This platform targets Kafka 3.6+, which provides production-grade KRaft support.

Benefits of KRaft over ZooKeeper:
- Eliminates a separate ZooKeeper cluster (reduces operational surface by ~40%)
- Faster controller failover (seconds vs. tens of seconds with ZooKeeper)
- Simpler security model (one system to secure instead of two)
- Supports larger partition counts per cluster (millions vs. ZooKeeper's ~200,000 limit)

```properties
# KRaft mode broker configuration (server.properties)
process.roles=broker,controller
node.id=1
controller.quorum.voters=1@broker1:9093,2@broker2:9093,3@broker3:9093
listeners=PLAINTEXT://:9092,CONTROLLER://:9093
inter.broker.listener.name=PLAINTEXT
controller.listener.names=CONTROLLER
```

### Broker Configuration (`server.properties`)

```properties
# Storage
log.dirs=/var/kafka/data
log.retention.check.interval.ms=300000

# I/O threads -- set to number of disks * 2 (assume 2 data disks)
num.io.threads=8

# Network threads -- set to number of cores (assume 4-core broker)
num.network.threads=4

# Request handling
num.replica.fetchers=2
replica.fetch.max.bytes=1048576

# Replication defaults (overridden per-topic)
default.replication.factor=3
min.insync.replicas=2

# Log segment size (1 GB segments)
log.segment.bytes=1073741824

# Log cleaner (for delete cleanup policy)
log.cleanup.policy=delete
log.cleaner.enable=true

# Socket buffers
socket.send.buffer.bytes=102400
socket.receive.buffer.bytes=102400
socket.request.max.bytes=104857600

# Auto-create topics: DISABLED in production
auto.create.topics.enable=false
```

**`auto.create.topics.enable=false`** is critical in production. If a service misconfigures a topic name (e.g., `transactions.completed` instead of `transaction.completed`), auto-creation would silently create a new topic with default settings (1 partition, replication.factor=1) instead of failing fast with a clear error.

### Topic Creation Script

```bash
# Create transaction.initiated topic
kafka-topics.sh --create \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated \
  --partitions 12 \
  --replication-factor 3 \
  --config retention.ms=604800000 \
  --config cleanup.policy=delete \
  --config compression.type=snappy \
  --config min.insync.replicas=2

# Create transaction.initiated DLT
kafka-topics.sh --create \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated.DLT \
  --partitions 6 \
  --replication-factor 3 \
  --config retention.ms=2592000000 \
  --config cleanup.policy=delete
```

Repeat for all topics. Consider managing topic configuration via Terraform (`mongey/kafka` provider) or Confluent Schema Registry automation for infrastructure-as-code consistency.

### Recommended Monitoring Metrics

| Metric | Tool | Alert Threshold |
|---|---|---|
| Consumer group lag per partition | Kafka JMX / Prometheus | > 10,000 records |
| Under-replicated partitions | Kafka JMX | > 0 |
| Active controller count | Kafka JMX | != 1 |
| DLT topic consumer lag | Prometheus | > 0 |
| Producer request latency (p99) | Prometheus | > 500ms |
| Broker disk usage | Node Exporter | > 75% |

Use `kafka-consumer-groups.sh --describe --group <group-id>` or Kafka UI (Conduktor, AKHQ) for real-time lag monitoring.

---

*This document reflects the topic design as of the initial platform architecture. Revisit partition counts and retention policies quarterly as transaction volume data becomes available.*

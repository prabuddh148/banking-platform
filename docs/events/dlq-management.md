# Dead Letter Queue (DLT) Management

**Platform:** Banking Platform  
**Stack:** Java 21, Spring Boot 3.2.5, Apache Kafka, PostgreSQL 16  
**Last Updated:** 2026-06-15

---

## Table of Contents

1. [Overview](#1-overview)
2. [DLT Topic Naming Convention](#2-dlt-topic-naming-convention)
3. [Complete DLT Topic Inventory](#3-complete-dlt-topic-inventory)
4. [Retry Policy Configuration](#4-retry-policy-configuration)
5. [DLT Message Structure](#5-dlt-message-structure)
6. [Common Failure Scenarios](#6-common-failure-scenarios)
7. [Monitoring and Alerting](#7-monitoring-and-alerting)
8. [Operational Runbook: DLT Investigation](#8-operational-runbook-dlt-investigation)
9. [Message Replay Procedure](#9-message-replay-procedure)
10. [When NOT to Replay](#10-when-not-to-replay)
11. [DLT Consumer (Monitoring Only)](#11-dlt-consumer-monitoring-only)
12. [Retention and Cleanup](#12-retention-and-cleanup)

---

## 1. Overview

### What is a Dead Letter Topic?

A **Dead Letter Topic (DLT)** -- also called a Dead Letter Queue (DLQ) in non-Kafka systems -- is a dedicated Kafka topic where messages are sent after all retry attempts have been exhausted and the consumer still cannot process them successfully. Rather than dropping a failed message silently or blocking the main consumer forever, the DLT acts as a quarantine zone: messages are safely parked for investigation, root cause analysis, and selective replay once the underlying issue is resolved.

In an event-driven banking platform where events drive account creation, transaction processing, fraud detection, and notifications, **no message can be silently lost**. A dropped `transaction.initiated` event could mean a customer payment never executes. A dropped `fraud.decision` event could mean a fraudulent transaction is never blocked. DLTs are the last safety net in the reliability chain.

### Failure Taxonomy

Not all failures are equal. Understanding the distinction between failure types determines the correct remediation path:

**Transient Failures (Retry-able)**

These are temporary conditions that are expected to self-resolve. The consumer should retry with backoff and the message should only reach the DLT if all retries are exhausted:

- Database connection timeouts (network blip, connection pool exhaustion)
- Downstream service temporarily unavailable (HTTP 503, connection refused)
- External API rate limit (HTTP 429)
- Lock contention or deadlocks on the database

**Permanent Failures (Poison Pills)**

These are messages or consumer bugs that will fail every single time regardless of how many retries are attempted. Retrying wastes time and delays processing of other messages:

- Malformed JSON payload that cannot be deserialized
- Schema version mismatch between producer and consumer
- `NullPointerException` or `IllegalArgumentException` in business logic
- Duplicate key constraint violation (idempotency bug)
- Message content violates a hard business rule that can never be satisfied

Spring Kafka's `DefaultErrorHandler` handles both categories: it retries transient failures with exponential backoff and immediately routes poison pills to the DLT via the `addNotRetryableExceptions()` exclusion list.

### DLTs as the Safety Net

The DLT guarantee is simple: **every message that enters a source topic is either successfully processed or lands in the corresponding DLT within the retry window**. There is no third outcome. This property is critical for a banking platform where regulatory audit requirements demand full message traceability and zero silent data loss.

---

## 2. DLT Topic Naming Convention

### Naming Pattern

```
{source-topic}.DLT
```

The `.DLT` suffix is the standard Spring Kafka convention used by `DeadLetterPublishingRecoverer`. This pattern is automatically applied by the recoverer when no explicit destination override is configured, and it is used consistently across all services in this platform.

### Examples

| Source Topic | DLT Topic |
|---|---|
| `transaction.initiated` | `transaction.initiated.DLT` |
| `fraud.decision` | `fraud.decision.DLT` |
| `account.created` | `account.created.DLT` |
| `notification.requested` | `notification.requested.DLT` |

### DLT Topic Configuration Defaults

Regardless of the source topic's partition count, **all DLT topics use a fixed configuration**:

- **Partitions:** 6
- **Retention:** 30 days (`retention.ms = 2592000000`)
- **Replication Factor:** 3 (same as source topics)
- **Cleanup Policy:** `delete`

The partition count of 6 is intentional -- DLTs receive far fewer messages than source topics, and 6 partitions provides sufficient parallelism for any DLT consumer while keeping topic metadata overhead low.

---

## 3. Complete DLT Topic Inventory

| Source Topic | DLT Topic | Source Partitions | DLT Partitions | Retention | Responsible Consumer Group |
|---|---|---|---|---|---|
| `account.created` | `account.created.DLT` | 6 | 6 | 30 days | `account-service-group` |
| `account.status.changed` | `account.status.changed.DLT` | 6 | 6 | 30 days | `account-service-group` |
| `transaction.initiated` | `transaction.initiated.DLT` | 12 | 6 | 30 days | `transaction-service-group` |
| `transaction.processing` | `transaction.processing.DLT` | 12 | 6 | 30 days | `transaction-service-group` |
| `transaction.completed` | `transaction.completed.DLT` | 12 | 6 | 30 days | `audit-service-group` |
| `transaction.failed` | `transaction.failed.DLT` | 12 | 6 | 30 days | `audit-service-group` |
| `fraud.decision` | `fraud.decision.DLT` | 12 | 6 | 30 days | `fraud-service-group` |
| `fraud.detected` | `fraud.detected.DLT` | 6 | 6 | 30 days | `fraud-service-group` |
| `notification.requested` | `notification.requested.DLT` | 6 | 6 | 30 days | `notification-service-group` |

> **Note:** `audit-service-group` is responsible for monitoring DLTs for `transaction.completed` and `transaction.failed` because audit consumers must process every completed and failed transaction for regulatory reporting. Any DLT message in these topics indicates an audit gap.

---

## 4. Retry Policy Configuration

### Spring Kafka DefaultErrorHandler with Exponential Backoff

All consumer groups in this platform use a shared `DefaultErrorHandler` bean configured with `ExponentialBackOffWithMaxRetries`. The handler intercepts consumer exceptions, applies the backoff schedule, and after the final retry, delegates to `DeadLetterPublishingRecoverer` to route the message to the corresponding `.DLT` topic.

### Backoff Schedule

| Attempt | Delay Before Attempt | Cumulative Time Elapsed |
|---|---|---|
| 1 (initial) | 0s (immediate) | 0s |
| 2 | 1s | 1s |
| 3 | 2s | 3s |
| 4 | 4s | 7s |
| 5 | 8s | 15s |
| **DLT** | 16s (final wait) | **~31s total** |

After approximately 31 seconds of retrying, the message is considered unprocessable and is published to the DLT. The consumer then commits the offset on the source topic and moves to the next message.

### Configuration Code

```java
@Configuration
public class KafkaErrorHandlerConfig {

    @Bean
    public DefaultErrorHandler errorHandler(KafkaTemplate<String, Object> kafkaTemplate) {
        // Route failed messages to {source-topic}.DLT
        // Partition assignment: source partition % 6 (since all DLTs have 6 partitions)
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(kafkaTemplate,
            (record, ex) -> new TopicPartition(record.topic() + ".DLT", record.partition() % 6));

        // Exponential backoff: 1s -> 2s -> 4s -> 8s -> 16s (5 retries total)
        ExponentialBackOffWithMaxRetries backOff = new ExponentialBackOffWithMaxRetries(5);
        backOff.setInitialInterval(1000L);   // First retry after 1 second
        backOff.setMultiplier(2.0);          // Each subsequent retry doubles the wait
        backOff.setMaxInterval(16000L);      // Cap at 16 seconds

        DefaultErrorHandler handler = new DefaultErrorHandler(recoverer, backOff);

        // Poison pills: do not retry deserialization or JSON parsing failures
        // These will always fail -- send immediately to DLT on first failure
        handler.addNotRetryableExceptions(DeserializationException.class);
        handler.addNotRetryableExceptions(JsonProcessingException.class);

        // Business logic bugs: immediate DLT routing, no retry
        handler.addNotRetryableExceptions(IllegalArgumentException.class);

        return handler;
    }
}
```

> **Important:** The `DeadLetterPublishingRecoverer` partition formula `record.partition() % 6` ensures that messages from high-partition source topics (12 partitions) are correctly mapped to the DLT's 6 partitions. Partition 0 and 6 on the source both map to DLT partition 0, partition 1 and 7 map to DLT partition 1, and so on.

### Registering the Handler with Listener Container Factory

```java
@Bean
public ConcurrentKafkaListenerContainerFactory<String, Object> kafkaListenerContainerFactory(
        ConsumerFactory<String, Object> consumerFactory,
        DefaultErrorHandler errorHandler) {
    ConcurrentKafkaListenerContainerFactory<String, Object> factory =
        new ConcurrentKafkaListenerContainerFactory<>();
    factory.setConsumerFactory(consumerFactory);
    factory.setCommonErrorHandler(errorHandler);
    return factory;
}
```

---

## 5. DLT Message Structure

### Payload

The original message payload is published to the DLT **unchanged**. No transformation, truncation, or enrichment is applied to the message body. The consumer that failed receives the byte array exactly as it was read from the source partition.

### DLT Headers

Spring Kafka's `DeadLetterPublishingRecoverer` automatically appends the following headers to every DLT message. These headers contain the full diagnostic context required to investigate the failure without needing to correlate logs separately:

| Header Key | Type | Description |
|---|---|---|
| `kafka_dlt-exception-fqcn` | String | Fully qualified class name of the exception (e.g., `org.springframework.kafka.support.serializer.DeserializationException`) |
| `kafka_dlt-exception-message` | String | Exception message text |
| `kafka_dlt-exception-stacktrace` | String | Full Java stack trace as a string |
| `kafka_dlt-original-topic` | String | Source topic name (e.g., `transaction.initiated`) |
| `kafka_dlt-original-partition` | Integer | Source partition number |
| `kafka_dlt-original-offset` | Long | Offset of the message in the source topic |
| `kafka_dlt-original-timestamp` | Long | Epoch milliseconds timestamp of the original message |
| `kafka_dlt-original-consumer-group` | String | Consumer group ID that failed to process the message |

### Example: Failed TransactionInitiatedEvent in the DLT

The following is an example of what a `transaction.initiated.DLT` message looks like when inspected with `kafka-console-consumer.sh --property print.headers=true`:

**Headers:**

```
kafka_dlt-exception-fqcn: com.fasterxml.jackson.core.JsonProcessingException
kafka_dlt-exception-message: Unrecognized field "legacy_amount_cents" (class com.bank.transaction.event.TransactionInitiatedEvent), not marked as ignorable
kafka_dlt-exception-stacktrace: com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException: Unrecognized field ...
kafka_dlt-original-topic: transaction.initiated
kafka_dlt-original-partition: 7
kafka_dlt-original-offset: 4821093
kafka_dlt-original-timestamp: 1750000000000
kafka_dlt-original-consumer-group: transaction-service-group
```

**Payload (JSON):**

```json
{
  "eventId": "evt-9f3a2b1c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
  "eventType": "TRANSACTION_INITIATED",
  "transactionId": "txn-123456789",
  "accountId": "acc-987654321",
  "amount": 250.00,
  "currency": "USD",
  "legacy_amount_cents": 25000,
  "initiatedAt": "2026-06-15T09:30:00Z",
  "merchantId": "merch-001",
  "channel": "MOBILE"
}
```

In this example, an older producer published a field `legacy_amount_cents` that the current consumer's `TransactionInitiatedEvent` class does not recognize. Because `JsonProcessingException` is in the not-retryable list, this message was routed to the DLT immediately on the first attempt without consuming any retry budget.

---

## 6. Common Failure Scenarios

| Failure Type | Example | Retryable? | Resolution |
|---|---|---|---|
| Database connection timeout | PostgreSQL connection pool exhausted during peak load | Yes | Auto-recovers after retry window; pool frees up connections |
| Duplicate key constraint violation | `transaction_id` already exists in `transactions` table | No | Idempotency bug -- producer is sending duplicate events; fix deduplication logic in producer |
| NullPointerException in processing logic | `event.getMerchantId()` returns null, NPE in downstream call | No | Code bug -- fix null check or schema validation; redeploy; replay from DLT |
| Downstream service unavailable | Fraud service returns HTTP 503 during processing | Yes | Auto-recovers when fraud service restores; message retried and processed normally |
| Malformed JSON / schema mismatch | Unknown field in payload, missing required field | No | Poison pill -- investigate payload source; discard after confirming event is stale or re-emit from producer |
| External API timeout | Payment network gateway times out on authorization | Yes | Retried with backoff; auto-recovers when gateway responds |
| Insufficient funds (business rule) | Account balance insufficient for debit | No (not an error) | Business outcome, not a consumer failure; handled in application logic, emits `transaction.failed` event; never reaches DLT |
| Deserialization exception | Avro schema registry returns unknown schema ID | No | Schema registry connectivity issue or schema version mismatch; fix registry or schema; replay |
| Database deadlock | Two consumers contend on the same account row | Yes | PostgreSQL resolves deadlock; retry succeeds on next attempt |
| Message too large | Payload exceeds broker `message.max.bytes` limit | No | Producer misconfiguration; fix at source; do not replay oversized messages |

---

## 7. Monitoring and Alerting

### Key Metric: Consumer Lag on DLT Topics

The primary signal for DLT health is **consumer lag on DLT topics**. Under normal operating conditions, DLT consumer lag should be zero at all times -- DLT consumers read messages only to store them for human review, and they should keep up with arrival rate immediately. A lag greater than 0 means messages are sitting in the DLT unacknowledged by the monitoring consumer.

Beyond lag, the **rate of DLT message arrivals** is equally important. A sudden spike in DLT arrival rate on `transaction.initiated.DLT` or `fraud.decision.DLT` indicates a consumer bug or infrastructure failure affecting the hot path.

### Prometheus Queries

**DLT consumer lag across all DLT topics:**

```promql
kafka_consumer_group_lag{topic=~".*\\.DLT"}
```

**DLT message arrival rate (messages per minute) per topic:**

```promql
rate(kafka_topic_partition_current_offset{topic=~".*\\.DLT"}[5m]) * 60
```

**Total DLT message count by topic:**

```promql
sum by (topic) (kafka_topic_partition_current_offset{topic=~".*\\.DLT"})
```

### Alert Thresholds

| Severity | Condition | Action |
|---|---|---|
| **WARNING** | Any DLT topic has consumer lag > 0 for more than 5 minutes | Notify on-call Slack channel `#banking-platform-alerts`; begin investigation |
| **CRITICAL** | Any DLT topic has lag > 100 messages | PagerDuty escalation to on-call engineer during business hours; escalation to engineering lead outside hours |
| **CRITICAL** | `transaction.initiated.DLT` or `fraud.decision.DLT` receives > 10 messages in 1 minute | Immediate PagerDuty page; potential systemic failure in transaction or fraud pipeline |

### Grafana Dashboard

The **Banking Platform DLT Health** dashboard (located under `Dashboards > Banking > Events > DLT`) includes:

- DLT message count per topic (time series, 1h window)
- DLT message arrival rate per topic (messages/min)
- Consumer lag per DLT topic per consumer group
- Top failure exception types (from DLT header `kafka_dlt-exception-fqcn`)
- DLT message age distribution (oldest unresolved message per topic)

### Spring Boot Actuator

For a quick operational check without accessing Grafana:

```bash
# Consumer group status via Spring Boot Actuator
curl -s http://localhost:8080/actuator/kafka | jq '.consumers'

# Liveness and readiness probes
curl -s http://localhost:8080/actuator/health | jq '.components.kafka'
```

---

## 8. Operational Runbook: DLT Investigation

Follow these steps in order when a DLT alert fires or when DLT messages are suspected.

### Step 1: Identify Which DLT Topics Have Messages

Check all consumer group offsets to find which DLT topics have lag:

```bash
# Check audit-service-group (monitors transaction.completed.DLT and transaction.failed.DLT)
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --group audit-service-group

# Check transaction-service-group
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --group transaction-service-group

# Check all groups at once and filter for DLT topics
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --all-groups 2>/dev/null | grep "\.DLT"
```

Look for any row where the `LAG` column is greater than 0 on a `.DLT` topic.

### Step 2: Read Messages from the DLT Topic

Inspect the first 10 messages in the affected DLT topic to understand the failure pattern:

```bash
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated.DLT \
  --from-beginning \
  --property print.headers=true \
  --property print.key=true \
  --max-messages 10
```

Replace `transaction.initiated.DLT` with the specific DLT topic that showed lag in Step 1.

### Step 3: Inspect Error Headers to Diagnose Root Cause

From the output in Step 2, examine the headers on each message:

- **`kafka_dlt-exception-fqcn`** -- Identifies the exception type. If you see `DeserializationException` or `JsonProcessingException`, this is a schema/payload issue. If you see `DataAccessException` or `CannotAcquireLockException`, this is a database issue.
- **`kafka_dlt-exception-message`** -- The human-readable error message. Often sufficient to pinpoint the root cause without reading the full stack trace.
- **`kafka_dlt-exception-stacktrace`** -- Full stack trace. Look for the first `at com.bank.*` frame to find the exact line in the application code that threw the exception.
- **`kafka_dlt-original-timestamp`** -- Convert to a datetime to correlate with application logs and deployment history.
- **`kafka_dlt-original-consumer-group`** -- Confirms which service failed.

Cross-reference the `kafka_dlt-original-timestamp` with application logs in Kibana or the observability stack to find the corresponding log entries from the failing consumer.

### Step 4: Fix the Underlying Issue

Based on the diagnosis from Step 3:

- **Code bug (NPE, logic error):** Fix the bug in the relevant service, write a unit test reproducing the failure, open a PR, deploy to staging and then production.
- **Database issue (connection pool, deadlock):** Investigate PostgreSQL metrics; adjust connection pool size in `application.yml` (`spring.datasource.hikari.maximum-pool-size`); consider adding indexes if lock contention is query-performance related.
- **Downstream service unavailable:** Confirm the downstream service has been restored. Check its health endpoint and recent deployment history.
- **Schema mismatch:** Coordinate with the producer team to either fix the producer payload or update the consumer to handle the field (add `@JsonIgnoreProperties(ignoreUnknown = true)` if the extra field is safe to ignore).

### Step 5: Verify Fix Works on a Test Message Before Replaying

Before replaying all DLT messages, validate the fix works on a single message:

```bash
# Extract a single DLT message payload to a file for testing
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated.DLT \
  --from-beginning \
  --property print.key=true \
  --max-messages 1 \
  --timeout-ms 3000 > /tmp/test-message.txt

# Publish only that single message to the source topic
# (manually paste the key and payload into the producer)
kafka-console-producer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated \
  --property parse.key=true
```

Then monitor the source topic's consumer logs for that specific `transactionId` to confirm successful processing. Only proceed to full replay in Step 6 once the single-message test succeeds.

### Step 6: Replay Messages from DLT Back to Source Topic

See [Section 9](#9-message-replay-procedure) for full replay commands.

---

## 9. Message Replay Procedure

> **Warning:** Replaying messages to a source topic may re-trigger downstream business logic. Always confirm the fix is deployed and verify with a single-message test (Step 5 of the runbook) before bulk replaying.

### Basic Replay: All Messages from DLT to Source Topic

```bash
# Read from DLT and write to source topic
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated.DLT \
  --from-beginning \
  --property print.key=true \
  --timeout-ms 5000 | \
kafka-console-producer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated \
  --property parse.key=true
```

### Selective Replay: Skip Poison Pills

When the DLT contains a mix of retryable failures (now fixed) and poison pills (still broken), filter out poison pills by exception type before replaying. Use a custom consumer script or the `kafka-streams` replay utility:

```bash
# Using kcat (formerly kafkacat) to filter messages by header before replaying
# Only replay messages where exception is NOT a deserialization failure
kcat -b localhost:9092 \
  -t transaction.initiated.DLT \
  -C \
  -f '%h %s\n' \
  -o beginning \
  -e | \
grep -v "DeserializationException" | \
awk '{print $NF}' | \
kcat -b localhost:9092 \
  -t transaction.initiated \
  -P
```

### Replay with Key Preservation

Key preservation is critical for Kafka ordering guarantees. The basic replay above uses `parse.key=true` to preserve the original message key, ensuring replayed messages land on the same partition as the original (by key hash). Never replay without key preservation unless you explicitly need to repartition.

### Rate-Limited Replay

For high-volume DLT topics (e.g., `transaction.initiated.DLT` with thousands of messages), replay in controlled batches to avoid overwhelming the downstream service:

```bash
# Replay 100 messages at a time using --max-messages
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated.DLT \
  --from-beginning \
  --max-messages 100 \
  --property print.key=true \
  --timeout-ms 5000 | \
kafka-console-producer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated \
  --property parse.key=true

# Wait and monitor before replaying next batch
# Repeat advancing the offset through the DLT
```

### Production Replay Recommendation

For production replay of more than a handful of messages, prefer a **dedicated replay service or admin tool** (such as a Spring Boot admin endpoint that reads from DLT and publishes to source topic with full observability, rate limiting, and dry-run capability) over raw shell commands. Raw shell replay lacks:

- Per-message success/failure tracking
- Idempotency checking before re-publishing
- Rate limiting with back-pressure
- Audit logging of which messages were replayed by whom and when

---

## 10. When NOT to Replay

Replaying DLT messages is not always the correct action. The following scenarios require **discard or further investigation** instead of replay:

1. **Poison pill messages (schema mismatch, malformed payload):** Replaying a message that cannot be deserialized will result in immediate re-routing to the DLT. The DLT entry count will increment again but nothing will be processed. Fix the schema issue at the producer, then re-emit the event from the source of truth -- do not replay the original broken payload.

2. **Consumer bug not yet fixed:** If the underlying code bug that caused the DLT messages has not been deployed to production, replaying will send all messages back to the DLT immediately. Replay only after the fix is live and verified in Step 5 of the runbook.

3. **Duplicate business operations:** If the consumer performed a partial operation before failing (e.g., debited the account but failed to emit the `transaction.processing` event), replaying the original event may cause a double-debit. Investigate the database state for each affected `transactionId` before replaying. Use the `transactionId` as an idempotency key in the consumer to guard against duplicates.

4. **Stale events beyond business SLA:** If a `fraud.decision` event is 48 hours old and the underlying transaction has already been resolved (either approved or declined by a fallback mechanism), replaying the fraud decision may override a correct final state. Events older than the business SLA for each event type should be reviewed by a domain expert before replay.

5. **Messages with security violations:** If forensic investigation reveals that a DLT message payload was tampered with (e.g., `amount` field modified in transit, signature validation failed), the message must be discarded and a security incident opened. Replaying a tampered payload could introduce fraudulent data into the system.

---

## 11. DLT Consumer (Monitoring Only)

### Purpose

Each team may optionally deploy a lightweight DLT consumer service that reads all DLT topics and persists messages to a relational database table for human inspection via an internal admin UI. This consumer **does not reprocess** business logic -- its sole purpose is to make DLT contents visible to operations and engineering without requiring Kafka CLI access.

### Consumer Behavior

- Subscribes to all DLT topics using a dedicated consumer group (e.g., `dlq-monitor-group`)
- Reads every arriving DLT message
- Extracts the payload and all DLT headers
- Inserts a row into the `dlt_messages` table
- Commits offset -- the message is "handled" from the DLT consumer's perspective
- Does not publish the message anywhere

### Database Schema: `dlt_messages`

```sql
CREATE TABLE dlt_messages (
    id                   BIGSERIAL PRIMARY KEY,
    source_topic         VARCHAR(255)    NOT NULL,
    dlt_topic            VARCHAR(255)    NOT NULL,
    message_key          VARCHAR(512),
    payload              JSONB           NOT NULL,
    exception_class      VARCHAR(512)    NOT NULL,
    exception_message    TEXT,
    exception_stacktrace TEXT,
    original_offset      BIGINT          NOT NULL,
    original_partition   INTEGER         NOT NULL,
    original_timestamp   TIMESTAMPTZ     NOT NULL,
    consumer_group       VARCHAR(255)    NOT NULL,
    received_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    status               VARCHAR(32)     NOT NULL DEFAULT 'PENDING'
                             CHECK (status IN ('PENDING', 'RESOLVED', 'DISCARDED')),
    resolved_by          VARCHAR(255),
    resolved_at          TIMESTAMPTZ,
    resolution_notes     TEXT
);

-- Index for fast lookup by topic and status
CREATE INDEX idx_dlt_messages_topic_status
    ON dlt_messages (dlt_topic, status, received_at DESC);

-- Index for looking up by original message key
CREATE INDEX idx_dlt_messages_key
    ON dlt_messages (message_key)
    WHERE message_key IS NOT NULL;
```

### Status Lifecycle

```
PENDING -> RESOLVED   (message was replayed successfully and root cause is fixed)
PENDING -> DISCARDED  (message is a poison pill or stale event; will not be replayed)
```

Operations staff update the `status`, `resolved_by`, `resolved_at`, and `resolution_notes` fields via the admin UI after completing investigation and any replay or discard action.

---

## 12. Retention and Cleanup

### Kafka Retention Policy

All DLT topics are configured with a 30-day retention window:

```properties
retention.ms=2592000000   # 30 days in milliseconds
cleanup.policy=delete
```

Messages that are not consumed or replayed within 30 days are **automatically deleted by Kafka** based on the broker's log retention process. There is no manual cleanup required.

### Operational SLA

- **Days 0-7:** Investigate root cause, deploy fix, verify, replay.
- **Days 8-21:** If not yet resolved, escalate within the team and track as a P2 engineering issue in the backlog.
- **Days 22-29:** If message age approaches 30 days without resolution, **escalate immediately to the engineering lead**. Evaluate whether the event's business context can be reconstructed from other sources (database state, audit logs) before the DLT message expires.
- **Day 30:** Message is permanently deleted by Kafka. No recovery is possible from Kafka after this point.

### Handling Imminent Expiry

If a DLT message is approaching 30-day expiry and cannot be replayed (e.g., the fix is not ready), options in priority order:

1. **Re-publish the DLT message to itself** to reset the clock -- this is not recommended as it loses original header timestamps.
2. **Store the message in the `dlt_messages` database table** via the DLT monitoring consumer (see Section 11) -- this preserves the payload and headers indefinitely in PostgreSQL independent of Kafka retention.
3. **Export the message payload to object storage** (S3/GCS) as a cold archive with full header context, keyed by `{dlt_topic}/{original_partition}/{original_offset}`.

### Long-Term Trend Analysis

The `dlt_messages` database table retains records indefinitely (subject to your PostgreSQL retention policy). Use this table for monthly DLT trend reports:

```sql
-- Top failure exceptions in the last 30 days
SELECT
    source_topic,
    exception_class,
    COUNT(*) AS failure_count,
    MIN(received_at) AS first_seen,
    MAX(received_at) AS last_seen
FROM dlt_messages
WHERE received_at >= NOW() - INTERVAL '30 days'
GROUP BY source_topic, exception_class
ORDER BY failure_count DESC;

-- DLT messages still PENDING older than 7 days
SELECT
    id, source_topic, dlt_topic, exception_class,
    received_at, NOW() - received_at AS age
FROM dlt_messages
WHERE status = 'PENDING'
  AND received_at < NOW() - INTERVAL '7 days'
ORDER BY received_at ASC;
```

---

## Reference

### Relevant Spring Kafka Classes

| Class | Package | Purpose |
|---|---|---|
| `DefaultErrorHandler` | `org.springframework.kafka.listener` | Primary error handler with retry and DLT routing |
| `DeadLetterPublishingRecoverer` | `org.springframework.kafka.listener.DeadLetterPublishingRecoverer` | Publishes failed messages to DLT topic |
| `ExponentialBackOffWithMaxRetries` | `org.springframework.util.backoff` | Configures exponential backoff with a retry cap |
| `DeserializationException` | `org.springframework.kafka.support.serializer` | Thrown when message deserialization fails |

### Key Configuration Properties

```yaml
spring:
  kafka:
    consumer:
      enable-auto-commit: false          # Manual offset commit required for DLT safety
      auto-offset-reset: earliest
    listener:
      ack-mode: RECORD                   # Commit offset per-record, not per-batch
      missing-topics-fatal: true         # Fail fast if DLT topics do not exist
```

### Kafka CLI Tools Reference

| Command | Purpose |
|---|---|
| `kafka-consumer-groups.sh --describe` | Check consumer lag per partition |
| `kafka-console-consumer.sh --from-beginning` | Read messages from start of topic |
| `kafka-console-producer.sh` | Publish messages to a topic |
| `kafka-topics.sh --describe` | Inspect topic partition and retention config |
| `kafka-configs.sh --entity-type topics` | View and update topic-level configurations |

# Outbox Backlog Recovery Runbook

**Banking Platform — On-Call Operations Guide**
Last Updated: 2026-06-15 | Owner: Platform Engineering

---

## Table of Contents

1. [What Is the Outbox Pattern and What Causes Backlog](#what-is-the-outbox-pattern)
2. [Detection](#detection)
3. [Step 1 — Determine Root Cause](#step-1-determine-root-cause)
4. [Step 2 — Fix Kafka If Down](#step-2-fix-kafka-if-down)
5. [Step 3 — Restart Relay If Stuck](#step-3-restart-relay-if-stuck)
6. [Step 4 — Handle FAILED Messages](#step-4-handle-failed-messages)
7. [Step 5 — Monitor Relay Progress](#step-5-monitor-relay-progress)
8. [Performance Characteristics](#performance-characteristics)
9. [Prevention](#prevention)
10. [Outbox Schema Reference](#outbox-schema-reference)

---

## What Is the Outbox Pattern

The **Transactional Outbox pattern** guarantees that database writes and Kafka event publication are atomic — either both succeed or neither does. This prevents the situation where a transaction is committed to the database but the corresponding Kafka event is lost (or vice versa).

### How It Works in This Platform

1. When a service processes a business action (e.g., creating a transaction), it writes to its primary table **and** inserts a row into `outbox_events` in the **same database transaction**.
2. The `OutboxEventRelay` component (a `@Scheduled` Spring bean) polls the `outbox_events` table every **5 seconds** and publishes PENDING events to Kafka.
3. Once successfully published, the event is marked `SENT`.
4. If publication fails after `maxRetryCount` attempts (default: 5), the event is marked `FAILED`.

### Outbox Tables

| Service | Database | Table |
|---------|----------|-------|
| account-service | account_db | `accounts.outbox_events` |
| transaction-service | transaction_db | `transactions.outbox_events` |

### What Causes Backlog

| Root Cause | Effect | Indicators |
|-----------|--------|-----------|
| Kafka broker is down | Relay cannot publish; PENDING events accumulate | Kafka connection errors in logs; broker health DOWN |
| Network partition between service and Kafka | Same as above | Intermittent publish failures |
| `OutboxEventRelay` crashed (app crash/OOM) | Relay not running; PENDING events accumulate | Service DOWN; relay thread not running |
| Relay is running but Kafka is rejecting messages | Messages hit retry limit → FAILED | `status = 'FAILED'` rows accumulating; Kafka error logs |
| DB replication lag (if relay reads from replica) | Relay misses new events | Accumulation with no obvious error |

---

## Detection

### Prometheus Alert

```
Alert: OutboxBacklogHigh
Condition: outbox_pending_count > 1000
For: 5 minutes
Severity: SEV2
```

```
Alert: OutboxBacklogWarning
Condition: outbox_pending_count > 500
For: 5 minutes
Severity: SEV3
```

### Manual Detection — SQL Queries

Run on both databases:

```sql
-- Run in account_db
SELECT
    status,
    COUNT(*) AS count,
    MIN(created_at) AS oldest_event,
    MAX(created_at) AS newest_event,
    NOW() - MIN(created_at) AS max_age
FROM accounts.outbox_events
GROUP BY status
ORDER BY status;
```

```sql
-- Run in transaction_db
SELECT
    status,
    COUNT(*) AS count,
    MIN(created_at) AS oldest_event,
    MAX(created_at) AS newest_event,
    NOW() - MIN(created_at) AS max_age
FROM transactions.outbox_events
GROUP BY status
ORDER BY status;
```

**Expected healthy output:**
```
 status | count | oldest_event | newest_event | max_age
--------+-------+--------------+--------------+---------
 SENT   | 52341 | 2026-06-10   | 2026-06-15   | 5 days
 PENDING|     3 | 2026-06-15   | 2026-06-15   | 00:00:08
```

**Backlog condition (alert triggers):**
```
 status  | count | oldest_event        | max_age
---------+-------+---------------------+---------
 PENDING | 4521  | 2026-06-15 13:00:00 | 00:52:00
 FAILED  |  142  | 2026-06-15 12:48:00 | 01:04:00
```

### Check via Service Actuator Metrics

```bash
# account-service outbox pending count
curl -s http://localhost:8081/actuator/metrics/outbox.pending.count | jq '.measurements[0].value'

# transaction-service outbox pending count
curl -s http://localhost:8082/actuator/metrics/outbox.pending.count | jq '.measurements[0].value'
```

---

## Step 1 — Determine Root Cause

Work through this decision tree before taking any action:

### Check 1: Is Kafka up?

```bash
# Test Kafka broker connectivity
kafka-broker-api-versions.sh --bootstrap-server localhost:9092
# If this hangs or errors → Kafka is down or unreachable
```

```bash
# Check Kafka container status (Docker)
docker ps | grep kafka
docker logs banking-kafka --tail 50

# Check Kafka container status (Kubernetes)
kubectl get pods -n kafka
kubectl logs -l app=kafka -n kafka --tail 50
```

### Check 2: Is the relay service up?

```bash
# Check service health
curl -s http://localhost:8081/actuator/health | jq '.status'   # account-service
curl -s http://localhost:8082/actuator/health | jq '.status'   # transaction-service

# Check if relay thread is active (look for scheduled task logs)
docker logs banking-account-service --tail 100 | grep -i "outbox\|relay\|scheduled"
docker logs banking-transaction-service --tail 100 | grep -i "outbox\|relay\|scheduled"
```

Expected relay log pattern (healthy):
```
2026-06-15 14:00:05 INFO  OutboxEventRelay - Processing 3 PENDING outbox events
2026-06-15 14:00:05 INFO  OutboxEventRelay - Published event TRANSACTION_INITIATED for aggregate a1b2c3d4
2026-06-15 14:00:05 INFO  OutboxEventRelay - Outbox relay cycle complete: 3 published, 0 failed
```

Signs of relay failure:
```
2026-06-15 14:00:05 ERROR OutboxEventRelay - Failed to publish event to Kafka: Connection refused
2026-06-15 14:00:10 ERROR OutboxEventRelay - Retry 1/5 failed for event id=xxx: Timeout
```

### Check 3: Are there FAILED messages?

```sql
-- Check for FAILED events and their error messages
SELECT
    id,
    aggregate_id,
    event_type,
    retry_count,
    last_error,
    created_at,
    updated_at
FROM transactions.outbox_events
WHERE status = 'FAILED'
ORDER BY created_at DESC
LIMIT 20;
```

### Decision Matrix

| Kafka Up? | Service Up? | FAILED rows? | Root Cause | Go To |
|-----------|------------|-------------|-----------|-------|
| No | Any | Any | Kafka is down | Step 2 |
| Yes | No | Any | Relay service crashed | Step 3 |
| Yes | Yes | Yes | Messages failing to publish | Step 4 |
| Yes | Yes | No | Transient — monitor | Step 5 |

---

## Step 2 — Fix Kafka If Down

> The outbox backlog will clear **automatically** once Kafka recovers. Do not manipulate outbox rows while Kafka is down.

### Diagnose Kafka Health

```bash
# Check ZooKeeper (if not KRaft mode)
echo "ruok" | nc localhost 2181
# Expected response: "imok"

# Check Kafka broker logs
docker logs banking-kafka --tail 200 | grep -E "ERROR|WARN|Exception|Shutdown"

# Check broker metrics
curl -s http://localhost:9090/api/v1/query?query=kafka_server_broker_state | jq
```

### Restart Kafka (Docker Compose)

```bash
# Graceful restart
docker-compose restart kafka

# If graceful restart fails, force restart
docker-compose stop kafka && docker-compose start kafka

# Check Kafka is healthy before proceeding
kafka-broker-api-versions.sh --bootstrap-server localhost:9092
```

### Restart Kafka (Kubernetes)

```bash
# Rolling restart of Kafka pods
kubectl rollout restart statefulset/kafka -n kafka

# Wait for pods to be ready
kubectl rollout status statefulset/kafka -n kafka --timeout=300s

# Verify all partitions have leaders
kafka-topics.sh --bootstrap-server localhost:9092 --describe | grep -v "Leader: [0-9]"
# This should return nothing — all partitions should have a leader
```

### Verify Kafka Recovery

```bash
# Verify producer can connect
echo "test-message" | kafka-console-producer.sh \
  --bootstrap-server localhost:9092 \
  --topic test-connectivity

# Verify consumer can read
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic test-connectivity \
  --from-beginning \
  --max-messages 1 \
  --timeout-ms 5000

# Once Kafka is up, the relay will automatically start publishing PENDING events
# Monitor the outbox count (expect it to drop within 1-2 relay cycles = 5-10 seconds per batch)
```

---

## Step 3 — Restart Relay If Stuck

The `OutboxEventRelay` is a `@Scheduled(fixedDelay = 5000)` Spring component. It resumes automatically when the service restarts.

### Restart the Affected Service

```bash
# account-service relay stuck
docker restart banking-account-service

# transaction-service relay stuck
docker restart banking-transaction-service

# Verify service starts and relay begins processing
docker logs banking-transaction-service --follow --tail 50 | grep -E "relay|outbox|Scheduled"
```

### Kubernetes Restart

```bash
# account-service
kubectl rollout restart deployment/account-service -n banking
kubectl rollout status deployment/account-service -n banking --timeout=120s

# transaction-service
kubectl rollout restart deployment/transaction-service -n banking
kubectl rollout status deployment/transaction-service -n banking --timeout=120s
```

### Verify Relay Is Running

```bash
# Check health — relay health is part of the service health check
curl -s http://localhost:8081/actuator/health | jq '.components.outboxRelay'

# Check logs for relay activity
docker logs banking-transaction-service --tail 30 | grep OutboxEventRelay
```

Expected log after restart:
```
2026-06-15 14:32:01 INFO  OutboxEventRelay - Starting outbox relay cycle
2026-06-15 14:32:01 INFO  OutboxEventRelay - Found 4521 PENDING events
2026-06-15 14:32:01 INFO  OutboxEventRelay - Processing batch of 100
2026-06-15 14:32:02 INFO  OutboxEventRelay - Batch complete: 100 published
```

---

## Step 4 — Handle FAILED Messages

Messages reach `FAILED` status when the relay has attempted publication `maxRetryCount` times (default 5) and all attempts failed.

### Step 4a — Inspect Failed Messages

```sql
-- View failed events with error details
SELECT
    id,
    aggregate_id,
    event_type,
    retry_count,
    last_error,
    LEFT(event_payload::text, 200) AS payload_preview,
    created_at
FROM transactions.outbox_events
WHERE status = 'FAILED'
ORDER BY created_at ASC
LIMIT 50;
```

### Step 4b — Categorize the Failure

| `last_error` Pattern | Root Cause | Action |
|---------------------|-----------|--------|
| `Connection refused` / `Timeout` | Kafka was down when retries ran | Fix Kafka, then reset to PENDING |
| `RecordTooLargeException` | Event payload exceeds Kafka message size limit | Fix payload, reset to PENDING |
| `SerializationException` | Schema mismatch or invalid JSON | Fix data, reset to PENDING |
| `TopicAuthorizationException` | ACL issue — service lacks write permission to topic | Fix Kafka ACLs, reset to PENDING |
| `UnknownTopicOrPartitionException` | Topic doesn't exist | Create topic, reset to PENDING |

### Step 4c — Fix Root Cause

Address the root cause before resetting status. Resetting without fixing will just cause messages to fail again.

```bash
# If Kafka topic is missing
kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --create \
  --topic {missing-topic} \
  --partitions 4 \
  --replication-factor 1

# If Kafka ACL issue (check broker logs for authorization errors)
docker logs banking-kafka --tail 100 | grep "Authorization"
```

### Step 4d — Reset FAILED Messages to PENDING

```sql
-- Reset all FAILED events in the last hour to PENDING for retry
-- Run in transaction_db
BEGIN;

UPDATE transactions.outbox_events
SET status = 'PENDING',
    retry_count = 0,
    last_error = NULL,
    updated_at = NOW()
WHERE status = 'FAILED'
  AND created_at > NOW() - INTERVAL '1 hour';

-- Check how many rows were updated
-- Should match the count you saw in detection step
-- If unexpectedly high, ROLLBACK and investigate

COMMIT;
```

```sql
-- Same for account_db
BEGIN;

UPDATE accounts.outbox_events
SET status = 'PENDING',
    retry_count = 0,
    last_error = NULL,
    updated_at = NOW()
WHERE status = 'FAILED'
  AND created_at > NOW() - INTERVAL '1 hour';

COMMIT;
```

```sql
-- To reset a specific event by ID (surgical approach for known-good events)
UPDATE transactions.outbox_events
SET status = 'PENDING',
    retry_count = 0,
    last_error = NULL,
    updated_at = NOW()
WHERE id = '{event_id}';
```

> **Warning:** Only reset events that are safe to re-publish. Some events may cause downstream duplicates if the original event was already consumed by Kafka before the producer got a timeout error. Check Kafka topic to see if the event was already published before resetting.

```bash
# Verify event was NOT already published before resetting
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated \
  --from-beginning \
  --property print.key=true \
  --timeout-ms 10000 \
  | grep "{aggregate_id}"
```

---

## Step 5 — Monitor Relay Progress

After applying fixes, monitor the outbox clearing:

### Real-Time SQL Monitoring

```bash
# Watch PENDING count drop every 10 seconds
watch -n 10 'psql -h localhost -U postgres -d transaction_db -c \
  "SELECT status, COUNT(*) FROM transactions.outbox_events GROUP BY status;"'
```

### Service Log Monitoring

```bash
# Follow relay logs in real time
docker logs banking-transaction-service --follow \
  | grep -E "OutboxEventRelay|PENDING|published|failed"
```

### Prometheus Monitoring

```promql
# Outbox pending count over time
outbox_pending_count{service="transaction-service"}

# Rate of outbox events being published
rate(outbox_events_published_total[1m])

# Failed events accumulating (should be 0 after fix)
outbox_failed_count{service="transaction-service"}
```

### Expected Recovery Timelines

| Backlog Size | Expected Clearance Time | Notes |
|-------------|------------------------|-------|
| < 1,000 | < 1 minute | Less than 2 relay cycles |
| 1,000 – 5,000 | 1–5 minutes | Relay batches 100/cycle at 5s intervals |
| 5,000 – 10,000 | 5–9 minutes | Standard recovery |
| 10,000 – 50,000 | 9–42 minutes | Monitor for DB lock contention during relay |
| > 50,000 | > 42 minutes | Consider increasing relay batch size temporarily |

---

## Performance Characteristics

The `OutboxEventRelay` default configuration:

| Parameter | Default | Config Key |
|-----------|---------|-----------|
| Poll interval | 5,000 ms | `outbox.relay.poll-interval-ms` |
| Batch size | 100 events | `outbox.relay.batch-size` |
| Max retry count | 5 | `outbox.relay.max-retry-count` |
| Retry backoff | 1,000 ms | `outbox.relay.retry-backoff-ms` |

**Throughput calculation:**
- 100 messages per 5-second cycle = **20 messages/second** baseline throughput
- 10,000 message backlog clears in approximately **8 minutes 20 seconds**
- 50,000 message backlog clears in approximately **41 minutes 40 seconds**

### Temporarily Increase Throughput During Recovery

```bash
# Increase batch size via environment variable (requires restart)
docker run -e OUTBOX_RELAY_BATCH_SIZE=500 -e OUTBOX_RELAY_POLL_INTERVAL_MS=1000 \
  banking-transaction-service

# This gives 500 messages per 1-second cycle = 500 messages/second
# 10,000 backlog clears in ~20 seconds
# IMPORTANT: Revert to defaults after backlog clears to avoid Kafka write pressure
```

> **Note:** Increasing throughput puts more write pressure on Kafka. Do not set batch size > 1000 without verifying Kafka broker capacity.

---

## Prevention

### Early Warning Alert at 500 Events

```yaml
# prometheus/alerts.yml
- alert: OutboxBacklogEarlyWarning
  expr: outbox_pending_count > 500
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "Outbox pending count is {{ $value }} — approaching alert threshold"
    description: "Service {{ $labels.service }} outbox has {{ $value }} pending events. Threshold is 1000."
    runbook: "docs/runbooks/outbox-backlog-recovery.md"

- alert: OutboxBacklogCritical
  expr: outbox_pending_count > 1000
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Outbox backlog critical: {{ $value }} pending events"
    runbook: "docs/runbooks/outbox-backlog-recovery.md"

- alert: OutboxFailedEventsAccumulating
  expr: increase(outbox_failed_count[10m]) > 10
  labels:
    severity: warning
  annotations:
    summary: "Outbox FAILED events increasing — possible systemic publish failure"
```

### Relay Health Check Integration

The outbox relay health is included in `/actuator/health`. Configure Kubernetes liveness and readiness probes to catch relay failures:

```yaml
# k8s deployment
livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8082
  initialDelaySeconds: 60
  periodSeconds: 30
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8082
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 3
```

### Archival of Old SENT Events

Prevent the outbox table from growing unbounded. Run nightly:

```sql
-- Archive SENT events older than 7 days (run as scheduled job)
DELETE FROM transactions.outbox_events
WHERE status = 'SENT'
  AND updated_at < NOW() - INTERVAL '7 days';

DELETE FROM accounts.outbox_events
WHERE status = 'SENT'
  AND updated_at < NOW() - INTERVAL '7 days';
```

---

## Outbox Schema Reference

```sql
-- transactions.outbox_events and accounts.outbox_events share this schema
CREATE TABLE {schema}.outbox_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_id  UUID NOT NULL,           -- e.g., transaction_id or account_id
    event_type    VARCHAR(100) NOT NULL,   -- e.g., 'TRANSACTION_INITIATED'
    event_payload JSONB NOT NULL,          -- The Kafka message payload
    topic         VARCHAR(200),            -- Target Kafka topic
    status        VARCHAR(20) NOT NULL DEFAULT 'PENDING',  -- PENDING | SENT | FAILED
    retry_count   INT NOT NULL DEFAULT 0,
    last_error    TEXT,                    -- Last error message if status=FAILED
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outbox_status_created ON {schema}.outbox_events (status, created_at)
  WHERE status = 'PENDING';  -- Partial index for relay performance
```

---

## Related Runbooks

- `docs/runbooks/kafka-consumer-lag.md` — If Kafka is slow to consume the backlog after it clears
- `docs/runbooks/saga-stuck-recovery.md` — If outbox backlog caused sagas to get stuck
- `docs/runbooks/dlq-reprocessing.md` — If outbox events ended up in DLT after replay
- `docs/runbooks/incident-response.md` — Overall incident response process
- `docs/runbooks/database-failover.md` — If outbox backlog is caused by DB issues

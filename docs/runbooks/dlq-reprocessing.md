# Dead Letter Queue (DLQ) Inspection and Reprocessing Runbook

**Banking Platform — On-Call Operations Guide**
Last Updated: 2026-06-15 | Owner: Platform Engineering

---

## Table of Contents

1. [When to Use This Runbook](#when-to-use-this-runbook)
2. [DLT Architecture Overview](#dlt-architecture-overview)
3. [Step 1 — Identify Which DLT Has Messages](#step-1-identify-which-dlt-has-messages)
4. [Step 2 — Read DLT Messages to Understand the Failure](#step-2-read-dlt-messages)
5. [Step 3 — Analyze the Error Headers](#step-3-analyze-error-headers)
6. [Step 4 — Classify the Failure](#step-4-classify-the-failure)
7. [Step 5 — Replay Safe Messages](#step-5-replay-safe-messages)
8. [Step 6 — Validate Replay Success](#step-6-validate-replay-success)
9. [Step 7 — Document the Incident](#step-7-document-the-incident)
10. [Messages You Must NOT Replay](#messages-you-must-not-replay)
11. [DLT Topic Reference](#dlt-topic-reference)

---

## When to Use This Runbook

Trigger this runbook when any of the following occur:

- **Kafka consumer lag on a `.DLT` topic** — messages are accumulating in a Dead Letter Topic
- **Prometheus alert `DLTMessageCount > 0`** fires for any DLT topic
- **Sagas are stuck** and the missing event is found in a DLT (see `saga-stuck-recovery.md`)
- **Explicit request from operations** to replay specific failed messages
- **After deploying a bug fix** that caused the original processing failure — replay messages that failed due to the now-fixed bug

> **Do NOT run this runbook proactively.** DLT messages are quarantined for good reason. Understand the failure before replaying anything.

---

## DLT Architecture Overview

The banking platform uses Spring Kafka's **Dead Letter Topic (DLT)** mechanism. When a Kafka consumer throws an exception, Spring Kafka retries the message (default: 3 retries with exponential backoff). If all retries are exhausted, the message is forwarded to the DLT with metadata headers describing the failure.

### DLT Naming Convention

All DLTs follow the pattern `{original-topic}.DLT`:

| Original Topic | DLT Topic | Consumer Group |
|---------------|-----------|----------------|
| `transaction.initiated` | `transaction.initiated.DLT` | `transaction-service-group` |
| `fraud.decision` | `fraud.decision.DLT` | `transaction-service-group` |
| `balance.reserved` | `balance.reserved.DLT` | `transaction-service-group` |
| `balance.reserve.requested` | `balance.reserve.requested.DLT` | `account-service-group` |
| `balance.release.requested` | `balance.release.requested.DLT` | `account-service-group` |
| `credit.initiated` | `credit.initiated.DLT` | `account-service-group` |
| `audit.events` | `audit.events.DLT` | `audit-service-group` |
| `notification.events` | `notification.events.DLT` | `notification-service-group` |

### DLT Message Headers

Every DLT message carries these headers set by Spring Kafka:

| Header | Description | Example |
|--------|-------------|---------|
| `kafka_dlt-original-topic` | Topic message came from | `transaction.initiated` |
| `kafka_dlt-original-partition` | Partition in original topic | `0` |
| `kafka_dlt-original-offset` | Offset in original topic | `12345` |
| `kafka_dlt-original-timestamp` | When original message was produced | `1749988800000` |
| `kafka_dlt-exception-fqcn` | Full exception class name | `java.lang.NullPointerException` |
| `kafka_dlt-exception-message` | Exception message | `Transaction not found: a1b2c3...` |
| `kafka_dlt-exception-stacktrace` | Full stack trace | (truncated) |

---

## Step 1 — Identify Which DLT Has Messages

### Via Kafka UI (fastest)

1. Open http://localhost:9090
2. Navigate to **Topics**
3. Filter by `.DLT` in the search box
4. Sort by **Messages** column descending
5. Any DLT with messages > 0 needs investigation

### Via CLI — Check All DLTs

```bash
# List all DLT topics
DLT_TOPICS=$(kafka-topics.sh --bootstrap-server localhost:9092 --list | grep "\.DLT")
echo "$DLT_TOPICS"

# Check message count for each DLT
for topic in $DLT_TOPICS; do
  count=$(kafka-run-class.sh kafka.tools.GetOffsetShell \
    --broker-list localhost:9092 \
    --topic "$topic" \
    --time -1 2>/dev/null \
    | awk -F: '{sum += $3} END {print sum}')
  if [ "$count" -gt "0" ] 2>/dev/null; then
    echo "*** $topic: $count messages ***"
  fi
done
```

### Via Consumer Group Describe

```bash
# Check consumer group lag on all groups (DLTs appear here if a consumer reads them)
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --all-groups \
  | grep "\.DLT"
```

---

## Step 2 — Read DLT Messages to Understand the Failure

### Read the First 10 Messages from a DLT

```bash
# Read messages from transaction.initiated.DLT (adjust topic name as needed)
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated.DLT \
  --from-beginning \
  --max-messages 10 \
  --property print.headers=true \
  --property print.timestamp=true \
  --property print.key=true
```

### Read Messages with Formatted Output

```bash
# Save DLT messages to a file for analysis
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated.DLT \
  --from-beginning \
  --max-messages 100 \
  --property print.headers=true \
  --property print.key=true \
  --timeout-ms 15000 > /tmp/dlt-messages-$(date +%Y%m%d-%H%M%S).txt

# View the file
cat /tmp/dlt-messages-*.txt | head -100
```

### Extract Just the Exception Information

```bash
# Parse headers to extract error messages
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated.DLT \
  --from-beginning \
  --max-messages 50 \
  --property print.headers=true \
  --timeout-ms 15000 \
  | grep -o "kafka_dlt-exception-message:[^,}]*" \
  | sort \
  | uniq -c \
  | sort -rn
```

This gives you a frequency count of distinct error messages — quickly shows if one bug is causing many failures vs. many different bugs.

---

## Step 3 — Analyze the Error Headers

### Decode Headers Manually

DLT headers are printed as `key:value` pairs separated by commas. Key headers to look for:

```
kafka_dlt-exception-fqcn:org.springframework.dao.DataIntegrityViolationException,
kafka_dlt-exception-message:duplicate key value violates unique constraint "transactions_pkey",
kafka_dlt-original-topic:transaction.initiated,
kafka_dlt-original-offset:12345
```

### Common Error Patterns and Their Meaning

| Exception Class | Error Message Pattern | Likely Cause |
|----------------|----------------------|-------------|
| `DataIntegrityViolationException` | `duplicate key value` | Transaction was already processed (idempotency key already exists) |
| `DataIntegrityViolationException` | `foreign key constraint` | Referenced entity (account) does not exist |
| `JsonProcessingException` | `Unrecognized field` / `Cannot deserialize` | Schema version mismatch — producer sent newer schema than consumer expects |
| `NullPointerException` | Any | Bug in consumer code — check stack trace |
| `FraudServiceException` | `Service unavailable` | Fraud service was down during retry window |
| `InsufficientFundsException` | `Insufficient balance` | Valid business rejection — should NOT be retried |
| `TransactionNotFoundException` | `Transaction not found` | Race condition — saga state not yet written |
| `IllegalStateException` | `Unexpected saga status` | Duplicate event delivery — saga already advanced |
| `SocketTimeoutException` | `Read timed out` | Database or downstream service was slow — transient |
| `HikariPool-1 - Connection is not available` | Pool exhaustion | DB connection pool was exhausted — transient |

### Check the Stack Trace

```bash
# Print full stack traces from DLT headers
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated.DLT \
  --from-beginning \
  --max-messages 5 \
  --property print.headers=true \
  --timeout-ms 10000 \
  | grep "kafka_dlt-exception-stacktrace" \
  | head -5
```

---

## Step 4 — Classify the Failure

Before replaying any message, classify each failure type. Use this decision matrix:

### Category A: Transient Failures — Safe to Replay

These failures occurred due to temporary conditions that are now resolved:

| Failure | Condition for Safe Replay |
|---------|--------------------------|
| DB timeout / pool exhaustion | DB is now healthy and pool is not exhausted |
| Network timeout to downstream service | Service is now healthy |
| Fraud service unavailable | Fraud service is now UP |
| `TransactionNotFoundException` (race condition) | Transaction record now exists in DB |
| `IllegalStateException: Unexpected saga status` | Saga has been manually reset to correct state |

```bash
# Verify DB is healthy before replaying DB-related failures
curl -s http://localhost:8082/actuator/health | jq '.components.db'
# Expected: {"status": "UP"}

# Verify connection pool is healthy
psql -h localhost -U postgres -d transaction_db -c "
  SELECT count(*) AS active_connections,
         (SELECT setting::int FROM pg_settings WHERE name='max_connections') AS max_connections
  FROM pg_stat_activity WHERE datname = 'transaction_db';"
```

### Category B: Poison Pills — Do NOT Replay

These are invalid messages that will always fail, regardless of retry:

| Failure | Action |
|---------|--------|
| `JsonProcessingException` — schema mismatch | Fix producer schema first; these messages cannot be parsed |
| `InsufficientFundsException` | Legitimate business rejection; do not replay |
| `duplicate key` — already processed | The transaction succeeded — do not replay (would create duplicate) |
| Malformed JSON in payload | Fix data source; discard these messages |
| Account does not exist (FK violation) | Account was deleted — business decision needed |

### Category C: Bug-Caused Failures — Fix Code First

These require a code fix before replay:

| Failure | Action |
|---------|--------|
| `NullPointerException` in consumer | Fix the NPE, deploy the fix, then replay |
| `IllegalArgumentException` from validation | Fix the validation bug, deploy, then replay |
| Any bug introduced in a recent deployment | Roll back or fix forward, then replay |

> **Rule:** Never replay Category B messages. Never replay Category C messages before the fix is deployed. For Category A, verify the root cause is truly resolved before replaying.

---

## Step 5 — Replay Safe Messages

### Option A: Simple Replay — Pipe All Messages Back to Source Topic

Use this when **all** messages in the DLT are safe to replay:

```bash
# Replay all messages from transaction.initiated.DLT back to transaction.initiated
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated.DLT \
  --from-beginning \
  --timeout-ms 30000 \
  --property print.key=true \
  --property key.separator="|" \
| kafka-console-producer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated \
  --property "parse.key=true" \
  --property "key.separator=|"
```

> **Warning:** This replays ALL messages in the DLT, including ones that might be poison pills mixed in with transient failures. Use Option B for selective replay.

### Option B: Selective Replay — Specific Messages by Key

Use this when only specific transactions need to be replayed, or to exclude known poison pills:

```bash
# Step 1: Export all DLT messages to a file
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic fraud.decision.DLT \
  --from-beginning \
  --timeout-ms 15000 \
  --property print.key=true \
  > /tmp/fraud-decision-dlt-all.txt

# Step 2: Review and edit the file — remove poison pill lines
# Each line format: {key}\t{value}
# Remove lines that should NOT be replayed

# Step 3: Replay only the safe messages
cat /tmp/fraud-decision-dlt-safe.txt | \
kafka-console-producer.sh \
  --bootstrap-server localhost:9092 \
  --topic fraud.decision \
  --property "parse.key=true"
```

### Option C: Targeted Replay Using kafka-consumer-groups.sh Reset

Use this to reposition a consumer group to re-consume messages from the original topic at a specific offset (more surgical than DLT replay):

```bash
# Reset consumer group offset to replay from a specific offset on the original topic
# CAUTION: This causes ALL partitions in the group to reset — use with extreme care
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --group transaction-service-group \
  --topic transaction.initiated \
  --reset-offsets \
  --to-offset 12340 \
  --execute

# Or reset to replay last N messages
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --group transaction-service-group \
  --topic transaction.initiated:0 \
  --reset-offsets \
  --shift-by -100 \
  --execute
```

> **Warning:** Offset reset affects all consumers in the group simultaneously. This will cause all messages from the reset point to be re-consumed, potentially causing duplicates. Only use this approach if:
> 1. The service has idempotent message processing (which this platform does via idempotency keys)
> 2. You have verified the target offset range
> 3. You have IC approval

### Option D: Custom Replay Script for Complex Filtering

```bash
#!/bin/bash
# replay-dlt-filtered.sh
# Replays only DLT messages for specific transaction IDs

BROKER="localhost:9092"
DLT_TOPIC="transaction.initiated.DLT"
TARGET_TOPIC="transaction.initiated"
TRANSACTION_IDS=("a1b2c3d4-e5f6-7890-abcd-ef1234567890" "b2c3d4e5-f6a7-8901-bcde-f12345678901")

for TX_ID in "${TRANSACTION_IDS[@]}"; do
  echo "Replaying transaction: $TX_ID"
  kafka-console-consumer.sh \
    --bootstrap-server "$BROKER" \
    --topic "$DLT_TOPIC" \
    --from-beginning \
    --timeout-ms 10000 \
    --property print.key=true \
  | grep "$TX_ID" | \
  kafka-console-producer.sh \
    --bootstrap-server "$BROKER" \
    --topic "$TARGET_TOPIC" \
    --property "parse.key=true"
done
```

---

## Step 6 — Validate Replay Success

After replaying, verify that messages were processed successfully and did NOT end up back in the DLT.

### Check Message Count in DLT Is Not Growing

```bash
# Record current DLT end offset
BEFORE=$(kafka-run-class.sh kafka.tools.GetOffsetShell \
  --broker-list localhost:9092 \
  --topic transaction.initiated.DLT \
  --time -1 | awk -F: '{sum += $3} END {print sum}')
echo "DLT message count before replay validation: $BEFORE"

# Wait 5 minutes after replay
sleep 300

# Check offset again
AFTER=$(kafka-run-class.sh kafka.tools.GetOffsetShell \
  --broker-list localhost:9092 \
  --topic transaction.initiated.DLT \
  --time -1 | awk -F: '{sum += $3} END {print sum}')
echo "DLT message count after 5 minutes: $AFTER"

if [ "$AFTER" -gt "$BEFORE" ]; then
  echo "ALERT: DLT is growing — replayed messages are failing again!"
else
  echo "OK: No new DLT messages"
fi
```

### Verify Transactions Reached COMPLETED or FAILED State

```sql
-- Check that replayed transactions completed
SELECT
    t.id,
    t.status,
    ss.saga_status,
    ss.current_step,
    ss.updated_at
FROM transactions.transactions t
JOIN transactions.saga_state ss ON ss.transaction_id = t.id
WHERE t.id IN (
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    'b2c3d4e5-f6a7-8901-bcde-f12345678901'
);
-- Expected: status = 'COMPLETED' or 'FAILED', saga_status = 'COMPLETED' or 'FAILED'
```

### Check Service Error Rate Hasn't Spiked

```promql
# Verify error rate is not increasing after replay
sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m])) by (application)

# Check DLT accumulation metric
kafka_consumer_group_lag{topic=~".*\\.DLT"}
```

### Confirm Consumer Group is Healthy

```bash
# No lag on source topic after replay is processed
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --group transaction-service-group \
  | awk 'NR>1 && $6 > 0 {print "LAG DETECTED:", $0}'
# Expected: no output (no lag)
```

---

## Step 7 — Document the Incident

After every DLT investigation and replay, document the following in the incident channel and in the RCA:

```markdown
## DLT Replay Report — {date} {time}

**Topic:** {dlt-topic}
**Total messages in DLT:** {count}
**Messages replayed:** {count}
**Messages discarded (poison pills):** {count}

**Root Cause:** {one sentence description of why messages went to DLT}

**Failure Classification:**
- {N} messages: Transient DB timeout — resolved by fixing connection pool
- {N} messages: Schema mismatch — discarded (producer was using old schema)

**Fix Applied:** {description}

**Replay Outcome:**
- {N} transactions now COMPLETED
- {N} transactions FAILED (legitimate business failures)
- {N} transactions re-entered DLT (requires further investigation)

**Validation:**
- DLT not growing for 10 minutes post-replay: YES/NO
- Consumer group lag: {value}
- Service error rate: {value}%

**Action Items:**
- [ ] {action to prevent recurrence} — Owner: {name} — Due: {date}
```

---

## Messages You Must NOT Replay

> **CRITICAL:** The following categories of messages must NEVER be replayed without explicit approval from a senior engineer and the IC. Replaying them can cause financial inconsistencies.

### 1. Duplicate Transaction Risk

If the original transaction **succeeded** (e.g., it's COMPLETED in the DB) but the consumer threw an exception on idempotency check, replaying will attempt to process the same transaction again. Check before replaying:

```sql
-- Verify transaction does NOT already exist and is COMPLETED
SELECT id, status FROM transactions.transactions
WHERE id = '{transaction_id_from_dlt_payload}';
-- If this returns a row with status = 'COMPLETED', DO NOT REPLAY
```

### 2. Schema Version Mismatch

Messages with `JsonProcessingException` or `SerializationException` cannot be parsed by the current consumer. Replaying them will put them right back in the DLT. They must be:
1. Discarded, OR
2. Manually re-encoded to the current schema and published as new messages

### 3. Legitimate Business Rejections

Messages that failed with `InsufficientFundsException`, `AccountFrozenException`, or `DailyLimitExceededException` are valid business failures. The transaction should be marked `FAILED`, not replayed. These are not bugs — they are expected outcomes.

### 4. Messages Older Than 24 Hours

Replaying very old messages can cause state inconsistencies — account balances may have changed, accounts may have been closed, downstream systems may have already compensated. Messages older than 24 hours require manual review and explicit IC approval before replay.

```bash
# Check message timestamp from DLT headers
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated.DLT \
  --from-beginning \
  --max-messages 10 \
  --property print.timestamp=true \
  | head -20
```

---

## DLT Topic Reference

| DLT Topic | Source Topic | Consuming Service | Critical? |
|-----------|-------------|------------------|-----------|
| `transaction.initiated.DLT` | `transaction.initiated` | transaction-service | YES — SEV1 if > 0 during business hours |
| `fraud.decision.DLT` | `fraud.decision` | transaction-service | YES — sagas will be stuck |
| `balance.reserved.DLT` | `balance.reserved` | transaction-service | YES — money is reserved but not moved |
| `balance.reserve.requested.DLT` | `balance.reserve.requested` | account-service | YES — balance not reserved |
| `balance.release.requested.DLT` | `balance.release.requested` | account-service | YES — compensation failed |
| `credit.initiated.DLT` | `credit.initiated` | account-service | YES — debit applied but no credit |
| `audit.events.DLT` | `audit.events` | audit-service | SEV2 — audit trail gap |
| `notification.events.DLT` | `notification.events` | notification-service | SEV3 — customer not notified |

---

## Related Runbooks

- `docs/runbooks/kafka-consumer-lag.md` — If DLT backlog is causing consumer lag issues
- `docs/runbooks/saga-stuck-recovery.md` — If DLT messages caused sagas to get stuck
- `docs/runbooks/outbox-backlog-recovery.md` — If outbox events are feeding the DLT
- `docs/runbooks/incident-response.md` — Overall incident response process

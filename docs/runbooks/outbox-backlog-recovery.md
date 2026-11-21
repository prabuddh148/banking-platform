# Runbook: Outbox Backlog Recovery

**Applies to:** account-service (`accounts_db`) and transaction-service (`transactions_db`).

**Symptoms:**
- `outbox_events` rows with `status = 'PENDING'` keep growing or are older than a few seconds.
- Rows with `status = 'FAILED'`.
- Downstream effects: stuck sagas, missing notifications/audit entries.

Background: [outbox-pattern](../architecture/outbox-pattern.md). The relay runs every
`outbox.relay.interval-ms` (2000 ms), sends up to 100 oldest `PENDING` rows, marks them `PUBLISHED`,
and after 5 failed attempts marks a row `FAILED`.

```bash
COMPOSE="docker compose -f docker/docker-compose.yml"
$COMPOSE exec postgres psql -U banking -d transactions_db   # or accounts_db
```

## 1. Measure

```sql
SELECT status, count(*) AS rows, min(created_at) AS oldest, max(attempts) AS max_attempts
FROM outbox_events GROUP BY status;

-- most common errors
SELECT event_type, left(last_error, 120) AS error, count(*)
FROM outbox_events WHERE status IN ('PENDING','FAILED') AND last_error IS NOT NULL
GROUP BY 1, 2 ORDER BY 3 DESC;
```

| Observation | Meaning |
|-------------|---------|
| PENDING growing, `attempts = 0`, no errors | Relay is not running (service down, scheduler stuck) |
| PENDING with `attempts > 0` and errors like `TimeoutException` | Kafka unreachable or slow |
| FAILED rows with serialization / "record too large" errors | Bad payload (poison row) |
| PENDING old but count small and dropping | Recovering by itself — just watch |

## 2. Fix the cause

### Relay not running
```bash
$COMPOSE ps transaction-service account-service
$COMPOSE logs --tail=200 transaction-service | grep -i outbox
$COMPOSE restart transaction-service
```
Check the service is healthy (`/actuator/health`). The relay starts with the application.

### Kafka unreachable
```bash
$COMPOSE ps kafka
$COMPOSE exec kafka kafka-broker-api-versions --bootstrap-server kafka:29092 | head -1
$COMPOSE exec kafka kafka-topics --bootstrap-server kafka:29092 --describe --topic banking.transaction.events
```
Check `KAFKA_BOOTSTRAP_SERVERS` of the service. Once Kafka is back, `PENDING` rows drain automatically
(100 per 2 s per instance).

### Poison row
Look at the payload:
```sql
SELECT id, event_type, aggregate_id, attempts, last_error, length(payload), payload
FROM outbox_events WHERE status = 'FAILED' ORDER BY created_at LIMIT 5;
```
If the payload is wrong because of a bug: fix and deploy first. Never edit `payload` by hand for
money events without a second person reviewing.

## 3. Re-queue FAILED rows

After the cause is fixed, put rows back into the queue. Do it in batches and oldest first so that
per-aggregate order is kept:

```sql
UPDATE outbox_events
SET status = 'PENDING', attempts = 0, last_error = NULL
WHERE id IN (
  SELECT id FROM outbox_events WHERE status = 'FAILED' ORDER BY created_at LIMIT 500
);
```

Re-sending is safe: consumers are idempotent by `eventId`.

Single row:
```sql
UPDATE outbox_events SET status = 'PENDING', attempts = 0, last_error = NULL WHERE id = '<uuid>';
```

## 4. Large backlog

- The relay does 100 rows per run per instance. With 2 s delay that is ~50 rows/s per instance plus
  send time. For a big backlog, temporarily lower `outbox.relay.interval-ms` (e.g. `200`) or run
  more instances.
- Watch consumer lag downstream while it drains ([kafka-consumer-lag](kafka-consumer-lag.md)).

## 5. Side effects to check after recovery

- Sagas that timed out while their event was stuck — see section 5 of
  [saga-stuck-recovery](saga-stuck-recovery.md) (money moved but transaction FAILED).
- Notifications arrive late (expected).

## 6. Verify

```sql
SELECT status, count(*), min(created_at) FROM outbox_events GROUP BY status;
```
`PENDING` oldest row is only a few seconds old; no `FAILED` rows (or each one has a ticket).

## 7. Housekeeping

Delete old published rows (see [data-retention-policy](../database/data-retention-policy.md)):
```sql
DELETE FROM outbox_events WHERE status = 'PUBLISHED' AND published_at < now() - interval '7 days';
```

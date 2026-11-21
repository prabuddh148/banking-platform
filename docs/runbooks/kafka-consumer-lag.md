# Runbook: Kafka Consumer Lag

**Symptom:** a consumer group is behind — lag (end offset minus committed offset) grows. Effects:
transfers slow or stuck (`account-service`, `fraud-service`, `transaction-service` groups), late
emails (`notification-service`), late audit entries (`audit-service`).

```bash
COMPOSE="docker compose -f docker/docker-compose.yml"
K="$COMPOSE exec kafka"
```

## 1. Measure

```bash
# all groups
$K kafka-consumer-groups --bootstrap-server kafka:29092 --list

# lag per partition for one group
$K kafka-consumer-groups --bootstrap-server kafka:29092 --describe --group fraud-service
```

Output columns: `TOPIC PARTITION CURRENT-OFFSET LOG-END-OFFSET LAG CONSUMER-ID HOST`.

| What you see | Meaning |
|--------------|---------|
| `CONSUMER-ID` empty | No active consumer — service down or not subscribed |
| Lag on **one** partition only, not moving | Stuck on one record (slow handler or retry loop) |
| Lag on all partitions, slowly moving | Consumer too slow for the load |
| Lag jumps then drains | Burst — fine |

Kafka UI (http://localhost:8090) shows the same under *Consumers*.

Groups and their topics:

| Group | Topics |
|-------|--------|
| `account-service` | `banking.transaction.events` |
| `transaction-service` | `banking.fraud.events`, `banking.account.events` |
| `fraud-service` | `banking.transaction.events` |
| `notification-service` | `banking.account.events`, `banking.transaction.events`, `banking.notification.events` |
| `audit-service` | `banking.account.events`, `banking.transaction.events`, `banking.fraud.events` |

## 2. Fix

### No active consumer
```bash
$COMPOSE ps <service>
$COMPOSE logs --tail=200 <service>
$COMPOSE restart <service>
```
Common causes: the service failed at startup (Flyway/DB problem), wrong `KAFKA_BOOTSTRAP_SERVERS`.

### Stuck on one partition
- Logs will show the same offset failing repeatedly. With `FixedBackOff(1000, 3)` a bad record should
  go to the DLT within ~3 s; if it doesn't, the handler may be **slow** (DB lock wait, SMTP timeout)
  rather than failing.
- For account-service, check for lock waits:
  ```sql
  -- accounts_db
  SELECT pid, state, wait_event_type, wait_event, now() - query_start AS running, left(query, 80)
  FROM pg_stat_activity WHERE datname = 'accounts_db' AND state <> 'idle' ORDER BY running DESC;
  ```
- For notification-service, check MailHog/SMTP reachability (`MAIL_HOST`, `MAIL_PORT`).

### Consumer too slow
- Scale the service up to **3 instances** max (3 partitions per topic). More instances than
  partitions sit idle.
- Look for slow DB queries (missing index, see [indexing-strategy](../database/indexing-strategy.md)).
- Long term: more partitions (see [topic-design](../events/topic-design.md) about ordering impact).

## 3. Resetting offsets (last resort)

Only when you *know* records must be skipped or re-read, and only with the group **stopped**.

```bash
$COMPOSE stop audit-service

# preview
$K kafka-consumer-groups --bootstrap-server kafka:29092 --group audit-service \
  --topic banking.account.events --reset-offsets --to-datetime 2026-11-21T10:00:00.000 --dry-run
# apply
$K kafka-consumer-groups --bootstrap-server kafka:29092 --group audit-service \
  --topic banking.account.events --reset-offsets --to-datetime 2026-11-21T10:00:00.000 --execute

$COMPOSE start audit-service
```

- **Re-reading** (moving back) is safe: consumers are idempotent.
- **Skipping** (moving forward, `--to-latest`, `--shift-by N`) loses events for that group. Never do
  this for `account-service` or `transaction-service` without reconciling the skipped events — it
  would leave sagas stuck.

## 4. Verify

`--describe` shows lag going down to ~0 and a `CONSUMER-ID` on every partition. Stuck sagas resolve
(see [saga-stuck-recovery](saga-stuck-recovery.md)).

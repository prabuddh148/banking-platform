# Runbook: Database Failover and Restore

**Context:** locally there is **one Postgres instance** with five databases (`accounts_db`,
`transactions_db`, `fraud_db`, `notifications_db`, `audit_db`). If it goes down, every servlet
service fails its health check. In production the target is a primary + streaming replica per
instance (managed Postgres or Patroni) with automatic failover.

```bash
COMPOSE="docker compose -f docker/docker-compose.yml"
```

## 1. Symptoms

- Services log `Connection refused` / `HikariPool - Connection is not available`.
- `/actuator/health` shows `db: DOWN`; the gateway circuit breakers open (`503 SERVICE_UNAVAILABLE`).
- Kafka consumers retry 3x then send records to DLTs (records failed because of the DB).

## 2. Immediate checks

```bash
$COMPOSE ps postgres
$COMPOSE logs --tail=200 postgres
$COMPOSE exec postgres pg_isready -U banking
```

Common local causes: container stopped, disk full (`docker system df`), too many connections.

```sql
-- connections per database (if you can still connect)
SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;
SHOW max_connections;
```

## 3. Local recovery

```bash
$COMPOSE restart postgres
# wait for healthy, then restart services so connection pools are clean
$COMPOSE restart account-service transaction-service fraud-service notification-service audit-service
```

Data is in the named volume and survives restarts. **Do not** run `down -v` — it deletes the volume.

## 4. Production failover (primary lost)

1. **Confirm** the primary is really down (not a network blip) — managed services usually do this.
2. **Promote** the replica (managed: automatic / "failover" button; Patroni: `patronictl failover`;
   plain streaming replica: `pg_ctl promote` or `SELECT pg_promote();`).
3. **Repoint** services: update the DNS name / `DB_HOST` to the new primary. Prefer a stable DNS
   name so services only need a restart, not a config change.
4. **Restart** services one by one (rolling) to reset connection pools.
5. **Check** replication lag at the moment of failover: transactions committed on the old primary but
   not yet replicated are lost. Because the outbox lives in the same DB, a lost business change also
   loses its event, so there is no inconsistency *inside* one service. But cross-service effects may
   exist (e.g. account-service lost a balance change that transaction-service already saw as
   COMPLETED). Run the reconciliation in [incident-response §4](incident-response.md).
6. Rebuild a new replica from the new primary.

## 5. After the DB is back

- **DLTs:** records that failed during the outage are in `*.DLT` — replay them
  ([dlq-reprocessing](dlq-reprocessing.md)).
- **Outbox:** `PENDING` rows drain automatically; re-queue `FAILED` rows
  ([outbox-backlog-recovery](outbox-backlog-recovery.md)).
- **Sagas:** some may have timed out → [saga-stuck-recovery](saga-stuck-recovery.md).
- **Flyway:** check every service started cleanly (`flyway_schema_history` all `success = true`).

## 6. Backup and restore

Backup (logical, per database):

```bash
for db in accounts_db transactions_db fraud_db notifications_db audit_db; do
  $COMPOSE exec -T postgres pg_dump -U banking -Fc "$db" > "backup-$db-$(date +%F).dump"
done
```

Restore one database (service stopped):

```bash
$COMPOSE stop account-service
$COMPOSE exec -T postgres psql -U banking -d postgres \
  -c "DROP DATABASE accounts_db WITH (FORCE);" -c "CREATE DATABASE accounts_db OWNER banking;"
$COMPOSE exec -T postgres pg_restore -U banking -d accounts_db < backup-accounts_db-2026-11-21.dump
$COMPOSE start account-service
```

Restoring **one** service's database to an older point creates inconsistency with the others (events
after the backup time are "forgotten" by that service). After a restore:
- reset the service's consumer group offsets to the backup time so it re-consumes events
  ([kafka-consumer-lag §3](kafka-consumer-lag.md)) — idempotency makes this safe;
- reconcile balances against completed transactions.

Production: use continuous archiving (WAL) for point-in-time recovery, test a restore every quarter,
and keep backups encrypted (see [data-retention-policy](../database/data-retention-policy.md)).

## 7. audit_db note

`audit_logs` blocks `UPDATE`/`DELETE`/`TRUNCATE` with triggers; `pg_restore` into an empty database
works normally (inserts only). Never disable the triggers to "fix" data.

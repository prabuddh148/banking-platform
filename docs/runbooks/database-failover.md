# PostgreSQL Database Failover Runbook

**Banking Platform — On-Call Operations Guide**
Last Updated: 2026-06-15 | Owner: Platform Engineering

---

## Table of Contents

1. [Overview and Setup Assumptions](#overview-and-setup-assumptions)
2. [Symptoms Triggering This Runbook](#symptoms-triggering-this-runbook)
3. [Step 1 — Confirm Primary Is Actually Down](#step-1-confirm-primary-is-actually-down)
4. [Step 2 — Check Replica Lag Before Promoting](#step-2-check-replica-lag)
5. [Step 3 — Promote Replica to Primary](#step-3-promote-replica-to-primary)
6. [Step 4 — Update Service Environment Variables](#step-4-update-service-environment-variables)
7. [Step 5 — Restart Affected Services](#step-5-restart-affected-services)
8. [Step 6 — Verify Services Reconnect](#step-6-verify-services-reconnect)
9. [Step 7 — Monitor for Data Loss](#step-7-monitor-for-data-loss)
10. [Step 8 — Rebuild Old Primary as New Replica](#step-8-rebuild-old-primary-as-new-replica)
11. [Per-Service Failover Impact](#per-service-failover-impact)
12. [RTO and RPO Targets](#rto-and-rpo-targets)
13. [Automated Failover with Patroni](#automated-failover-with-patroni)
14. [Failover Checklist](#failover-checklist)

---

## Overview and Setup Assumptions

### Database Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Banking Services                    │
│   account-service (8081)  transaction-service (8082) │
└──────────────┬───────────────────────────┬───────────┘
               │                           │
               ▼                           ▼
┌──────────────────────────────────────────────────────┐
│                    PgBouncer                          │
│              Connection Pooler :5432                  │
└──────────────────────┬───────────────────────────────┘
                       │
           ┌───────────┼────────────┐
           ▼                        ▼
┌──────────────────┐    ┌──────────────────────────────┐
│  PRIMARY         │    │  REPLICA (Standby)           │
│  account_db      │───▶│  account_db (read-only)     │
│  transaction_db  │    │  transaction_db (read-only)  │
│  :5432           │    │  :5433                       │
│  (read/write)    │    │  Streaming replication       │
└──────────────────┘    └──────────────────────────────┘
```

### PostgreSQL 16 Versions

- **Primary:** Read/write — `DB_HOST` / port 5432
- **Replica:** Read-only standby with streaming replication — `DB_REPLICA_HOST` / port 5433
- **Replication mode:** Streaming replication (asynchronous by default; configure synchronous for zero RPO)
- **Connection pooling:** PgBouncer sits in front of both primary and replica

### Databases

| Database | Owner Service | Port (primary) |
|----------|--------------|----------------|
| `account_db` | account-service | 5432 |
| `transaction_db` | transaction-service | 5432 |

---

## Symptoms Triggering This Runbook

Trigger this runbook when you observe ANY of the following:

| Symptom | Where Observed |
|---------|---------------|
| `Health check FAILED: db` | `/actuator/health` on account-service or transaction-service |
| `Connection pool exhausted` | Service logs: `HikariPool-1 - Connection is not available, request timed out after 30000ms` |
| `FATAL: connection refused` or `FATAL: too many connections` | Service logs |
| PostgreSQL primary container/pod is not running | `docker ps` or `kubectl get pods` |
| `pg_lsclusters` shows primary in `down` state | On the DB host |
| Prometheus alert `PostgreSQLDown` | Grafana alert panel |
| All transactions returning 503/500 with DB-related errors | Grafana error rate panel |

> **Before proceeding with failover:** Rule out false positives. A transient network blip, a brief DB restart, or connection pool exhaustion can look like a full DB failure. Always verify the primary is truly unreachable from multiple vantage points.

---

## Step 1 — Confirm Primary Is Actually Down

### Check from Application Host

```bash
# Basic connectivity test
psql -h ${DB_HOST:-localhost} -p 5432 -U postgres -c "SELECT 1 AS alive" \
  --connect-timeout=5

# Expected when healthy:
#  alive
# -------
#      1

# Expected when down:
# psql: error: connection to server at "localhost" (127.0.0.1), port 5432 failed:
# Connection refused

# Check from multiple hosts if possible
psql -h 10.0.1.10 -p 5432 -U postgres -c "SELECT 1" --connect-timeout=5
```

### Check PostgreSQL Process Status

```bash
# On the DB host (if accessible via SSH)
pg_lsclusters
# Expected when healthy:
# Ver Cluster Port Status Owner    Data directory              Log file
# 16  main    5432 online postgres /var/lib/postgresql/16/main /var/log/...

# If primary is down output will show:
# 16  main    5432 down   postgres /var/lib/postgresql/16/main /var/log/...

# Check PostgreSQL system service
systemctl status postgresql@16-main
# Or for Docker:
docker inspect banking-postgres-primary --format='{{.State.Status}}'
```

### Check PostgreSQL Logs for Crash Reason

```bash
# On DB host
sudo tail -100 /var/log/postgresql/postgresql-16-main.log | grep -E "FATAL|PANIC|ERROR|LOG.*shutdown"

# Via Docker
docker logs banking-postgres-primary --tail 100 | grep -E "FATAL|PANIC|ERROR|shutdown"

# Via Kubernetes
kubectl logs -l app=postgres,role=primary -n banking --tail 100 \
  | grep -E "FATAL|PANIC|ERROR|shutdown"
```

### Rule Out Network Partition

```bash
# Try connecting from multiple points:
# 1. From the application server
# 2. From the replica (if accessible)
# 3. From a bastion host

# On the replica, check if it can see the primary
psql -h ${DB_HOST} -p 5432 -U replication_user -c "SELECT 1" \
  --connect-timeout=5 2>&1

# Check pg_stat_replication on primary (if it's still partially alive)
psql -h ${DB_HOST} -U postgres -c "SELECT * FROM pg_stat_replication;" \
  --connect-timeout=5 2>&1
```

> **If you can connect from SOME hosts but not others:** This is a network partition, NOT a DB failure. Do NOT promote the replica. Fix the network partition instead. Dual-primary (split-brain) is catastrophic in a financial system.

> **If the primary is truly unreachable from ALL hosts and all checks confirm it is down:** Proceed to Step 2.

---

## Step 2 — Check Replica Lag Before Promoting

Before promoting the replica, check how much data it has replicated from the primary. This determines potential data loss (RPO).

### Connect to the Replica

```bash
psql -h ${DB_REPLICA_HOST:-localhost} -p 5433 -U postgres
```

### Check Replication Lag

```sql
-- Run ON THE REPLICA
-- This shows how far behind the replica is from the primary
SELECT
    now() - pg_last_xact_replay_timestamp() AS replication_lag,
    pg_last_xact_replay_timestamp()          AS last_replicated_at,
    pg_is_in_recovery()                      AS is_replica;

-- Expected output (healthy, low lag):
--  replication_lag | last_replicated_at          | is_replica
-- ----------------+-----------------------------+------------
--  00:00:00.123   | 2026-06-15 14:32:01.877+00  | t

-- Output if replica was lagging:
--  replication_lag | last_replicated_at          | is_replica
-- ----------------+-----------------------------+------------
--  00:03:45.221   | 2026-06-15 14:28:16.656+00  | t
```

```sql
-- Check WAL receive position vs apply position
SELECT
    pg_last_wal_receive_lsn() AS received_lsn,
    pg_last_wal_replay_lsn()  AS applied_lsn,
    (pg_last_wal_receive_lsn() - pg_last_wal_replay_lsn()) AS bytes_behind;
```

### Record the Lag for Data Loss Assessment

| Replication Lag | Data Loss Estimate | Proceed? |
|----------------|-------------------|---------|
| < 1 second | Minimal — < 1 second of transactions | YES — proceed immediately |
| 1–60 seconds | Low — review with IC | YES with IC approval |
| 1–5 minutes | Moderate — significant transactions may be lost | ONLY with VP approval |
| > 5 minutes | High — major data loss | STOP — exhaust all options to recover primary first |

> **If lag is > 5 minutes:** Before promoting, make one more attempt to recover the primary. Check if it's a crash that PostgreSQL can auto-recover from (SIGKILL vs graceful shutdown vs disk full). Data loss in a banking system may have regulatory implications.

---

## Step 3 — Promote Replica to Primary

> **This is a one-way operation.** Once the replica is promoted, the old primary-replica relationship is severed. The old primary becomes an orphaned standalone instance. You cannot undo this without rebuilding.

### Method A: Manual Promotion (Self-Managed PostgreSQL)

```bash
# SSH to the replica host
ssh postgres-replica-host

# Promote the standby to primary
pg_ctl promote -D /var/lib/postgresql/16/main

# Expected output:
# waiting for server to promote.... done
# server promoted

# Verify it is now accepting writes
psql -h localhost -U postgres -c "SELECT pg_is_in_recovery();"
# Expected: f (false = primary)
# If still "t": promotion is still in progress — wait 10 seconds and retry

# Verify write access
psql -h localhost -U postgres -d transaction_db -c "
  UPDATE transactions.transactions SET updated_at = NOW()
  WHERE id = (SELECT id FROM transactions.transactions LIMIT 1);"
# Expected: UPDATE 1
```

### Method B: Managed Cloud — AWS RDS Failover

```bash
# Trigger failover for RDS Multi-AZ instance
aws rds failover-db-instance \
  --db-instance-identifier banking-postgres-primary \
  --region us-east-1

# Monitor failover progress
aws rds describe-events \
  --source-identifier banking-postgres-primary \
  --source-type db-instance \
  --duration 60 \
  --query 'Events[?Message!=null].{Time:Date, Message:Message}'

# Check instance status
aws rds describe-db-instances \
  --db-instance-identifier banking-postgres-primary \
  --query 'DBInstances[0].DBInstanceStatus'
# Wait for: "available"

# Get the new endpoint
aws rds describe-db-instances \
  --db-instance-identifier banking-postgres-primary \
  --query 'DBInstances[0].Endpoint.Address'
```

### Method C: Patroni Automated Failover (Recommended Production Setup)

```bash
# If Patroni is configured, failover is automatic.
# To manually trigger a switchover:
patronictl -c /etc/patroni/config.yml switchover banking-cluster \
  --master postgres-primary \
  --candidate postgres-replica \
  --force

# Check cluster status after switchover
patronictl -c /etc/patroni/config.yml list banking-cluster

# Expected output after successful failover:
# + Cluster: banking-cluster (7234567890) ----+----+-----------+
# | Member            | Host        | Role   | State   | TL | Lag in MB |
# +-------------------+-------------+--------+---------+----+-----------+
# | postgres-primary  | 10.0.1.10   | Replica | running | 2  |         0 |
# | postgres-replica  | 10.0.1.11   | Leader  | running | 2  |           |
# +-------------------+-------------+--------+---------+----+-----------+
```

---

## Step 4 — Update Service Environment Variables

After promoting the replica, all services must be pointed to the new primary's host/IP.

### Identify the New Primary Address

```bash
# Get new primary host (self-managed)
NEW_PRIMARY_HOST="10.0.1.11"  # The former replica's IP

# Get new primary endpoint (AWS RDS)
NEW_PRIMARY_HOST=$(aws rds describe-db-instances \
  --db-instance-identifier banking-postgres-primary \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text)

echo "New primary: $NEW_PRIMARY_HOST"
```

### Update Docker Compose

```bash
# Edit docker-compose.yml or create an override
cat > docker-compose.override.yml << EOF
version: '3.8'
services:
  account-service:
    environment:
      SPRING_DATASOURCE_URL: "jdbc:postgresql://${NEW_PRIMARY_HOST}:5432/account_db"
  transaction-service:
    environment:
      SPRING_DATASOURCE_URL: "jdbc:postgresql://${NEW_PRIMARY_HOST}:5432/transaction_db"
EOF
```

### Update Kubernetes ConfigMap / Secrets

```bash
# Update ConfigMap with new DB host
kubectl patch configmap banking-config -n banking \
  --type merge \
  -p "{\"data\": {\"DB_HOST\": \"${NEW_PRIMARY_HOST}\"}}"

# If using Kubernetes Secret for DB URL
kubectl create secret generic banking-db-secret \
  --from-literal=DB_URL="jdbc:postgresql://${NEW_PRIMARY_HOST}:5432/transaction_db" \
  --from-literal=ACCOUNT_DB_URL="jdbc:postgresql://${NEW_PRIMARY_HOST}:5432/account_db" \
  -n banking \
  --dry-run=client -o yaml | kubectl apply -f -
```

### Update PgBouncer Configuration (If Used)

```bash
# Edit /etc/pgbouncer/pgbouncer.ini on the PgBouncer host
# Update the [databases] section to point to new primary:
#
# [databases]
# account_db = host=10.0.1.11 port=5432 dbname=account_db
# transaction_db = host=10.0.1.11 port=5432 dbname=transaction_db

# Reload PgBouncer without dropping connections
psql -h localhost -p 6432 -U pgbouncer pgbouncer -c "RELOAD;"

# Verify PgBouncer is routing to new primary
psql -h localhost -p 6432 -U pgbouncer pgbouncer -c "SHOW DATABASES;"
```

---

## Step 5 — Restart Affected Services

Services must be restarted to pick up the new `SPRING_DATASOURCE_URL` and to flush stale connection pool entries pointing to the old primary.

```bash
# Docker Compose — restart services in dependency order
docker-compose up -d --force-recreate account-service transaction-service

# Wait for health checks to pass
sleep 30

# Verify services are starting
docker logs banking-account-service --tail 30 | grep -E "Started|ERROR|Failed"
docker logs banking-transaction-service --tail 30 | grep -E "Started|ERROR|Failed"
```

```bash
# Kubernetes — rolling restart of affected services
kubectl rollout restart deployment/account-service -n banking
kubectl rollout restart deployment/transaction-service -n banking

# Watch rollout progress
kubectl rollout status deployment/account-service -n banking --timeout=300s
kubectl rollout status deployment/transaction-service -n banking --timeout=300s
```

> **Note:** audit-service and notification-service do not write to the primary databases — they read from the event stream. However, if they have a direct DB dependency, restart them too.

---

## Step 6 — Verify Services Reconnect

```bash
# Check health endpoints — must show DB as UP
curl -s http://localhost:8081/actuator/health | jq '{status: .status, db: .components.db}'
curl -s http://localhost:8082/actuator/health | jq '{status: .status, db: .components.db}'

# Expected:
# {
#   "status": "UP",
#   "db": {
#     "status": "UP",
#     "details": {"database": "PostgreSQL", "validationQuery": "isValid()"}
#   }
# }
```

```bash
# Verify write access to the new primary from each service
# Run a test transaction (use a test account if available)
curl -s -X POST http://localhost:8082/api/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAccountId": "TEST-ACC-001",
    "targetAccountId": "TEST-ACC-002",
    "amount": 1.00,
    "currency": "USD",
    "description": "DB failover connectivity test"
  }' | jq '{transactionId: .id, status: .status}'
```

```bash
# Check HikariCP connection pool metrics
curl -s http://localhost:8082/actuator/metrics/hikaricp.connections.active | jq '.measurements[0].value'
curl -s http://localhost:8082/actuator/metrics/hikaricp.connections.pending | jq '.measurements[0].value'
# Expected: active > 0, pending = 0
```

---

## Step 7 — Monitor for Data Loss

Compare transaction counts before and after failover to estimate data loss.

### Check Transaction Counts

```sql
-- Run on the new primary (former replica)
-- Compare with any pre-failover snapshot you took
SELECT
    COUNT(*) AS total_transactions,
    MAX(created_at) AS latest_transaction,
    MIN(created_at) AS earliest_transaction,
    COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
    COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
    COUNT(*) FILTER (WHERE status = 'FAILED') AS failed
FROM transactions.transactions;
```

### Identify Transactions That May Have Been Lost

```sql
-- Find transactions in PENDING or STARTED state that were created during the outage window
-- These may have been committed to the old primary but not replicated
SELECT
    t.id,
    t.status,
    t.created_at,
    t.source_account_id,
    t.amount,
    ss.saga_status,
    ss.current_step
FROM transactions.transactions t
LEFT JOIN transactions.saga_state ss ON ss.transaction_id = t.id
WHERE t.created_at BETWEEN '{outage_start_time}' AND '{outage_end_time}'
ORDER BY t.created_at;
```

### Check for Balance Inconsistencies

```sql
-- Run on account_db (new primary)
-- Look for accounts where reserved_amount > 0 but saga is FAILED or missing
SELECT
    a.account_id,
    a.balance,
    a.reserved_amount,
    a.updated_at
FROM accounts.accounts a
WHERE a.reserved_amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM transactions.saga_state ss
    WHERE ss.saga_status IN ('STARTED', 'COMPENSATING')
  );
```

> **If data loss is confirmed:** Escalate immediately to the IC and VP Engineering. Notify the compliance team. Begin the data reconciliation process. See `docs/runbooks/data-reconciliation.md`.

---

## Step 8 — Rebuild Old Primary as New Replica

Once the old primary is recovered and data loss is documented, rebuild it as a streaming replica of the new primary.

### Step 8a — Stop the Old Primary (If Still Running)

```bash
# On the old primary host — stop PostgreSQL to prevent split-brain
pg_ctl stop -D /var/lib/postgresql/16/main -m fast

# Via Docker
docker stop banking-postgres-primary

# Via Kubernetes
kubectl scale statefulset postgres-primary --replicas=0 -n banking
```

### Step 8b — Use pg_basebackup to Sync the Old Primary

```bash
# SSH to the old primary host (now to become replica)
# Wipe old data directory and take a base backup from new primary
rm -rf /var/lib/postgresql/16/main/*

pg_basebackup \
  -h ${NEW_PRIMARY_HOST} \
  -p 5432 \
  -U replication_user \
  -D /var/lib/postgresql/16/main \
  -Fp \
  -Xs \
  -P \
  -R

# The -R flag creates recovery.conf / standby.signal automatically
# Expected output:
# 27443/27443 kB (100%), 2/2 tablespaces
```

### Step 8c — Start the New Replica

```bash
# Start PostgreSQL on the old-primary-now-replica
pg_ctl start -D /var/lib/postgresql/16/main

# Verify it started in standby mode
psql -h localhost -U postgres -c "SELECT pg_is_in_recovery();"
# Expected: t (true = standby/replica)

# Check it is replicating from the new primary
psql -h ${NEW_PRIMARY_HOST} -U postgres -c "SELECT * FROM pg_stat_replication;"
```

---

## Per-Service Failover Impact

| Service | Primary DB Dependency | Replica Read OK? | Failover Impact |
|---------|----------------------|-----------------|----------------|
| account-service | account_db | Partial (reads from replica are fine; writes need primary) | Cannot process balance changes; health shows DB DOWN |
| transaction-service | transaction_db | Partial (reads from replica are fine; writes need primary) | Cannot create/update transactions; sagas blocked |
| fraud-service | None (stateless, uses ML model) | N/A | **Not affected** — continues operating |
| notification-service | None (event-driven, reads Kafka) | N/A | **Not affected** — queues notifications |
| audit-service | audit_db (separate, optional) | N/A | Minor impact — audit writes delayed |
| api-gateway | None | N/A | **Not affected** — routes requests only |

> **Key insight:** fraud-service and notification-service do not directly depend on the primary databases. During a failover of account_db or transaction_db, these services continue running and can queue up their work. Once the primary is restored, the saga coordinator will catch up.

---

## RTO and RPO Targets

| Target | Value | Notes |
|--------|-------|-------|
| **RTO** (Recovery Time Objective) | **5 minutes** | Time from failure detection to services writing to new primary |
| **RPO** (Recovery Point Objective) | **< 1 minute** | Maximum data loss (replication lag window) |

### RTO Breakdown

| Phase | Target Duration |
|-------|----------------|
| Alert fires and on-call acknowledges | 0–2 min |
| Confirm primary is down (Step 1) | 1–2 min |
| Check replica lag (Step 2) | < 1 min |
| Promote replica (Step 3) | < 1 min |
| Update config and restart services (Steps 4-5) | 1–2 min |
| Verify health checks pass (Step 6) | < 1 min |
| **Total** | **4–8 min** |

> To achieve the 5-minute RTO target, **Patroni + automated failover** is required. Manual failover realistically takes 8–15 minutes.

---

## Automated Failover with Patroni

For production environments, configure Patroni to automatically detect and handle primary failures without manual intervention.

### Patroni Setup Overview

```yaml
# /etc/patroni/config.yml (per node)
scope: banking-cluster
namespace: /banking/
name: postgres-primary  # or postgres-replica on the other node

restapi:
  listen: 0.0.0.0:8008
  connect_address: 10.0.1.10:8008

etcd3:
  hosts: 10.0.1.20:2379  # Etcd for distributed consensus

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576  # 1MB — don't failover if replica is > 1MB behind

postgresql:
  listen: 0.0.0.0:5432
  connect_address: 10.0.1.10:5432
  data_dir: /var/lib/postgresql/16/main
  pg_hba:
    - host replication replication_user 10.0.0.0/8 md5
  authentication:
    replication:
      username: replication_user
      password: '{REPLICATION_PASSWORD}'
    superuser:
      username: postgres
      password: '{POSTGRES_PASSWORD}'
```

### Patroni Operational Commands

```bash
# Check cluster health
patronictl -c /etc/patroni/config.yml list banking-cluster

# Manual switchover (planned maintenance)
patronictl -c /etc/patroni/config.yml switchover banking-cluster --force

# Show cluster history (all role changes)
patronictl -c /etc/patroni/config.yml history banking-cluster

# Pause automatic failover (e.g., during maintenance)
patronictl -c /etc/patroni/config.yml pause banking-cluster

# Resume automatic failover
patronictl -c /etc/patroni/config.yml resume banking-cluster
```

---

## Failover Checklist

Use this checklist during a failover event. Check each box and timestamp it in the incident channel.

### Pre-Failover

- [ ] `{time}` — Alert acknowledged, incident channel opened
- [ ] `{time}` — Confirmed primary is unreachable from multiple hosts (Step 1)
- [ ] `{time}` — Ruled out network partition (can replica see the primary?)
- [ ] `{time}` — Checked replica lag: `{value}` (Step 2)
- [ ] `{time}` — IC and senior engineer approved promotion
- [ ] `{time}` — Recorded approximate time of primary failure: `{timestamp}`

### During Failover

- [ ] `{time}` — Replica promoted to primary (Step 3)
- [ ] `{time}` — Verified new primary accepting writes: `SELECT pg_is_in_recovery()` = false
- [ ] `{time}` — Updated `DB_HOST` environment variables (Step 4)
- [ ] `{time}` — Restarted account-service (Step 5)
- [ ] `{time}` — Restarted transaction-service (Step 5)
- [ ] `{time}` — All service health checks returning `"UP"` (Step 6)

### Post-Failover

- [ ] `{time}` — Transaction count verified — estimated data loss: `{value}`
- [ ] `{time}` — Balance consistency check completed (Step 7)
- [ ] `{time}` — Stakeholders notified of outcome
- [ ] `{time}` — Old primary stopped to prevent split-brain
- [ ] `{time}` — Old primary rebuilt as new replica (Step 8)
- [ ] `{time}` — Replication lag on new replica: `{value}`
- [ ] `{time}` — RCA scheduled for within 48 hours

---

## Related Runbooks

- `docs/runbooks/incident-response.md` — Overall incident response process
- `docs/runbooks/saga-stuck-recovery.md` — Sagas stuck due to DB outage
- `docs/runbooks/outbox-backlog-recovery.md` — Outbox backlog that accumulated during DB outage
- `docs/runbooks/kafka-consumer-lag.md` — Consumer lag that built up during the incident

# Runbook: Incident Response

Use this when something is wrong in a running environment and you don't yet know what. It links to
the specific runbooks once the cause is clear.

## 0. Setup used in all runbooks

```bash
# full stack; use docker/docker-compose.dev.yml if only infra runs in Docker
COMPOSE="docker compose -f docker/docker-compose.yml"

# psql into a service database
$COMPOSE exec postgres psql -U banking -d transactions_db

# Kafka CLI (Confluent image, no .sh suffix; internal listener kafka:29092)
$COMPOSE exec kafka kafka-consumer-groups --bootstrap-server kafka:29092 --list
```

## 1. Severity levels

| Sev | Meaning | Examples | Response |
|-----|---------|----------|----------|
| **SEV1** | Money is wrong or at risk, or the platform is down | Balance mismatch, duplicate debit, all logins fail | Immediately, all hands |
| **SEV2** | Core flow degraded | Transfers stuck in PENDING, one service down, DLT filling up | Within 30 min |
| **SEV3** | Non-core degraded | Emails not sent, audit lag, admin page slow | Next business day |

## 2. First 10 minutes

1. **Acknowledge** and name an incident lead (one person decides).
2. **Check health of everything**:
   ```bash
   $COMPOSE ps
   for p in 8080 8081 8082 8083 8084 8085; do echo -n "$p "; curl -s localhost:$p/actuator/health; echo; done
   ```
   As admin, `GET /api/v1/system/health` on the gateway shows every service at once.
3. **Look at the signals**:
   - Gateway logs (`RequestLoggingFilter`) — which routes return 5xx / 503 (circuit breaker open)?
   - Grafana (http://localhost:3000) — error rate, latency, JVM memory.
   - Kafka UI (http://localhost:8090) — consumer lag, DLT topics.
   - Outbox backlog:
     ```sql
     -- in accounts_db and transactions_db
     SELECT status, count(*), min(created_at) FROM outbox_events GROUP BY status;
     ```
   - Stuck sagas:
     ```sql
     -- transactions_db
     SELECT status, count(*), min(updated_at) FROM saga_states
     WHERE status NOT IN ('COMPLETED','FAILED') GROUP BY status;
     ```
4. **Decide**: is money at risk? If yes → SEV1, go to section 4 first.

## 3. Symptom → runbook

| Symptom | Go to |
|---------|-------|
| Transactions stay `PENDING` / `PROCESSING` | [saga-stuck-recovery](saga-stuck-recovery.md) |
| `outbox_events` PENDING growing or FAILED rows | [outbox-backlog-recovery](outbox-backlog-recovery.md) |
| Consumer lag growing | [kafka-consumer-lag](kafka-consumer-lag.md) |
| Messages in `*.DLT` | [dlq-reprocessing](dlq-reprocessing.md) |
| DB connection errors / Postgres down | [database-failover](database-failover.md) |
| All requests `401 INVALID_TOKEN` | `JWT_SECRET` differs between gateway and services, or was rotated without overlap — redeploy with the same secret |
| `503 SERVICE_UNAVAILABLE` from gateway | Circuit breaker open: the target service is down or slow — check its health and logs |
| Emails not arriving | notification-service logs, MailHog (http://localhost:8025), `SELECT status, count(*) FROM notifications GROUP BY status;` |

## 4. Money at risk (SEV1)

1. **Stop new money movement** if the cause is unknown: scale transaction-service to 0 or block
   `/api/v1/transactions/**` at the gateway. Reads can stay up.
   ```bash
   $COMPOSE stop transaction-service
   ```
2. **Do not** delete or edit rows, offsets or topics until the cause is understood.
3. **Collect evidence**: the transaction ids, `GET /api/v1/audit/logs/correlation/{id}`, ledger rows
   in accounts_db, saga state, outbox rows.
4. **Reconcile** completed transactions against balances:
   ```sql
   -- transactions_db: completed transfers in the window
   SELECT id, reference, source_account_id, destination_account_id, amount
   FROM transactions WHERE status = 'COMPLETED' AND completed_at > now() - interval '1 hour';
   ```
   Compare with the account-service ledger / processed rows for the same `transaction_id`. Every
   COMPLETED transaction must have exactly one ledger row, and vice versa.
5. Fix the root cause, restart transaction-service, monitor.

## 5. Communication

- Post status every 30 min (SEV1) / 2 h (SEV2): what is impacted, what we know, next update time.
- Customer-facing message only after the incident lead approves.

## 6. After the incident

- Write a blameless post-mortem within 5 business days: timeline, root cause, impact (number of
  transactions/customers), what went well, action items with owners.
- Add or update a runbook if a step was missing.

# Indexing Strategy

## Principles

1. **Index for the queries we actually run.** Every index below maps to an API filter, a consumer
   lookup or a scheduled job. Unused indexes only slow down writes.
2. **Uniqueness is a business rule.** Unique indexes enforce idempotency (one balance update per
   transaction, one audit row per event) — the database is the last line of defense against duplicates.
3. **Composite index = equality columns first, then the sort/range column.** For example
   `(account_id, evaluated_at DESC)` serves "decisions of account X, newest first".
4. **Paged lists sort by time.** List endpoints return newest first, so the time column is part of
   the index to avoid a sort over the whole table.
5. **Partial indexes for "hot" subsets.** The outbox relay only reads `PENDING` rows, which are a tiny
   fraction of the table.
6. Add indexes in a **new Flyway migration**; for big tables in production use
   `CREATE INDEX CONCURRENTLY` (in a migration that is not wrapped in a transaction).

## Per service

### accounts_db

| Index | Columns | Why |
|-------|---------|-----|
| UNIQUE | `accounts(account_number)` | `GET /accounts/number/{accountNumber}`, uniqueness |
| B-tree | `accounts(customer_id, created_at DESC)` | Customer's own account list |
| B-tree | `accounts(status)` | Admin filter by status |
| PK | `account_balances(account_id)` | Row lock `FOR UPDATE` by id |
| B-tree | `account_status_history(account_id, changed_at DESC)` | History per account |
| UNIQUE | balance ledger `(transaction_id)` | Idempotent balance updates |
| Partial | `outbox_events(created_at) WHERE status = 'PENDING'` | Relay query (oldest first) |
| B-tree | `outbox_events(status, created_at)` | Monitoring / cleanup by status |
| PK | `processed_events(event_id)` | Duplicate check |

### transactions_db

| Index | Columns | Why |
|-------|---------|-----|
| UNIQUE | `transactions(reference)` | `GET /transactions/reference/{reference}` |
| UNIQUE partial | `transactions(initiated_by, idempotency_key) WHERE idempotency_key IS NOT NULL` | `Idempotency-Key` handling |
| B-tree | `transactions(initiated_by, created_at DESC)` | Customer's list |
| B-tree | `transactions(source_account_id, created_at DESC)` | Filter by `accountId` |
| B-tree | `transactions(destination_account_id, created_at DESC)` | Filter by `accountId` |
| B-tree | `transactions(status, created_at DESC)` | Admin filter by status |
| B-tree | `transaction_status_history(transaction_id, changed_at)` | Status history |
| UNIQUE | `saga_states(transaction_id)` | 1:1 saga lookup |
| B-tree | `saga_states(status, updated_at)` | Saga timeout job (`status IN (...) AND updated_at < now() - 15 min`) |
| Partial / B-tree | `outbox_events` as in accounts_db | Relay |
| PK | `processed_events(event_id)` | Duplicate check |

### fraud_db (from `V1__create_fraud_schema.sql`)

| Index | Columns | Why |
|-------|---------|-----|
| UNIQUE | `fraud_decisions(transaction_id)` | Idempotency, `GET /decisions/transaction/{id}` |
| B-tree | `idx_fraud_decisions_account_time (account_id, evaluated_at DESC)` | VelocityRule, PatternAnomalyRule |
| B-tree | `idx_fraud_decisions_risk_level (risk_level)` | `/stats` |
| UNIQUE | `fraud_alerts(transaction_id)` | One alert per transaction |
| B-tree | `idx_fraud_alerts_status (status, created_at DESC)` | Alert queue (OPEN first) |
| B-tree | `idx_fraud_alerts_risk_level (risk_level)` | Filter |

### notifications_db

| Index | Columns | Why |
|-------|---------|-----|
| B-tree | `notifications(recipient_id, created_at DESC)` | Customer's notifications |
| B-tree | `notifications(status, attempts)` | Retry job (FAILED with attempts < 3) |
| B-tree | `notifications(channel)` | Admin filter |
| PK + index | `account_contacts(account_id)`, `idx_account_contacts_customer(customer_id)` | Contact lookup by account and by customer |
| PK | `processed_events(event_id)` | Duplicate check |

### audit_db (from `V1__create_audit_schema.sql`)

| Index | Columns | Why |
|-------|---------|-----|
| UNIQUE | `uk_audit_logs_event_id (event_id)` | One row per event |
| B-tree | `idx_audit_logs_occurred_at (occurred_at DESC)` | Default list, `from`/`to`, summary |
| B-tree | `idx_audit_logs_aggregate (aggregate_id, occurred_at)` | `/logs/aggregate/{id}` |
| B-tree | `idx_audit_logs_actor (actor, occurred_at DESC)` | `/logs/actor/{actor}` |
| B-tree | `idx_audit_logs_correlation (correlation_id, occurred_at)` | `/logs/correlation/{id}` |
| B-tree | `idx_audit_logs_event_type (event_type, occurred_at DESC)` | Filter + summary |
| B-tree | `idx_audit_logs_severity (severity, occurred_at DESC)` | Filter + summary |

## Checking index usage

```sql
-- Is the query using an index?
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM transactions WHERE initiated_by = 'CUST-1001' ORDER BY created_at DESC LIMIT 20;

-- Indexes that are never used (candidates to drop)
SELECT relname AS table, indexrelname AS index, idx_scan
FROM pg_stat_user_indexes WHERE idx_scan = 0 ORDER BY relname;

-- Index sizes
SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes ORDER BY pg_relation_size(indexrelid) DESC;
```

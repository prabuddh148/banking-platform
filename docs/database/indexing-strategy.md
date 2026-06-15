# Database Indexing Strategy

## Table of Contents

- [Index Philosophy](#index-philosophy)
- [Index Inventory by Service](#index-inventory-by-service)
  - [account-service Indexes](#account-service-indexes)
  - [transaction-service Indexes](#transaction-service-indexes)
  - [fraud-service Indexes](#fraud-service-indexes)
  - [notification-service Indexes](#notification-service-indexes)
  - [audit-service Indexes](#audit-service-indexes)
- [JSONB Indexing](#jsonb-indexing)
- [Composite Index Rationale](#composite-index-rationale)
- [Partial Indexes](#partial-indexes)
- [Index Maintenance](#index-maintenance)
- [Query Pattern Analysis](#query-pattern-analysis)

---

## Index Philosophy

Indexes are created to serve known query patterns, not speculatively. Every index in this document has a corresponding query pattern that justifies its existence. Indexes that are not serving queries are pure overhead: they consume disk space, slow down INSERT, UPDATE, and DELETE operations (each index B-tree must be updated on every write), and add noise that makes `EXPLAIN` output harder to interpret.

**Principles**:

1. **Measure first**: Use `pg_stat_user_indexes` to verify an index is being used before treating it as permanent. After 30 days of production traffic, indexes with zero `idx_scan` are candidates for removal.
2. **One index per access pattern**: Avoid redundant indexes. A composite index on `(status, initiated_at)` satisfies queries filtering only on `status` (leftmost-prefix scan) as well as queries filtering on both columns.
3. **Index on write is a write tax**: Every insert into `transactions` must update 6+ index B-trees. High-write tables (outbox_events, audit_logs) get the minimum viable index set.
4. **CONCURRENTLY for production**: All `CREATE INDEX` statements in migration files use `CONCURRENTLY` to avoid locking the table during the index build.
5. **Foreign keys need indexes**: PostgreSQL does not automatically index foreign key columns. Every FK column is explicitly indexed to prevent sequential scans during FK-constraint checks and logical join operations.

---

## Index Inventory by Service

### account-service Indexes

**Schema**: `accounts`

#### Table: `accounts`

```sql
-- Enforced by UNIQUE constraint (auto-creates a unique B-tree index)
CREATE UNIQUE INDEX uq_accounts_account_number
    ON accounts.accounts(account_number);

-- Supports: "get all accounts for customer X"
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_customer_id
    ON accounts.accounts(customer_id);

-- Supports: "get all ACTIVE accounts" / "get all FROZEN accounts for compliance review"
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_status
    ON accounts.accounts(status);

-- Supports: "accounts created in the last 30 days" (onboarding and reporting dashboards)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_created_at
    ON accounts.accounts(created_at DESC);
```

**Query patterns served**:

- `SELECT * FROM accounts WHERE customer_id = $1` uses `idx_accounts_customer_id`.
- `SELECT * FROM accounts WHERE status = 'FROZEN'` uses `idx_accounts_status`.
- `SELECT * FROM accounts WHERE customer_id = $1 AND status = 'ACTIVE'` uses `idx_accounts_customer_id` (lowest-cardinality filter first) and filters on status in memory — acceptable because one customer typically holds 1–10 accounts.

#### Table: `account_balance`

```sql
-- Enforced by UNIQUE constraint; also serves as the FK lookup index
CREATE UNIQUE INDEX uq_account_balance_account_id
    ON accounts.account_balance(account_id);
```

Single-row lookup by `account_id` is the only access pattern. The unique constraint index is sufficient.

#### Table: `account_status_history`

```sql
-- Supports: "get all status changes for account X" (account detail view, compliance)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_acc_status_history_account_id
    ON accounts.account_status_history(account_id);

-- Supports: "status changes in the last 24 hours" (operational monitoring)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_acc_status_history_changed_at
    ON accounts.account_status_history(changed_at DESC);
```

#### Table: `outbox_events` (accounts schema)

```sql
-- Critical for relay performance: only PENDING rows need to be scanned.
-- Partial index dramatically reduces the working set as PUBLISHED rows dominate over time.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_acc_outbox_pending
    ON accounts.outbox_events(created_at ASC)
    WHERE status = 'PENDING';

-- For FAILED event monitoring and retry escalation
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_acc_outbox_failed
    ON accounts.outbox_events(created_at DESC)
    WHERE status = 'FAILED';
```

**Why the partial index here is critical**: After one week of operation, the `outbox_events` table may contain millions of rows, 99.9% of which are `PUBLISHED`. Without a partial index, the relay's query `SELECT * FROM outbox_events WHERE status = 'PENDING' ORDER BY created_at LIMIT 100` would perform a sequential scan on millions of rows. With the partial index, the scan covers only the tiny PENDING subset, keeping relay latency in single-digit milliseconds.

---

### transaction-service Indexes

**Schema**: `transactions`

#### Table: `transactions`

```sql
-- Enforced by UNIQUE constraint
CREATE UNIQUE INDEX uq_transactions_reference_number
    ON transactions.transactions(reference_number);

-- Supports: "get all transactions FROM account X" (account statement, outgoing)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txn_source_account_id
    ON transactions.transactions(source_account_id);

-- Supports: "get all transactions TO account X" (account statement, incoming credits)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txn_target_account_id
    ON transactions.transactions(target_account_id);

-- Supports: "get all PENDING transactions" (operations queue, SLA monitoring)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txn_status
    ON transactions.transactions(status);

-- Supports: "transactions in date range" (reporting, exports)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txn_initiated_at
    ON transactions.transactions(initiated_at DESC);

-- Composite: most critical for paginated account statement queries.
-- "Get account X's COMPLETED transactions, newest first, page N"
-- Both predicates served by one index scan; eliminates the Sort node on initiated_at.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txn_status_initiated_at
    ON transactions.transactions(status, initiated_at DESC);
```

**EXPLAIN ANALYZE comparison for the composite index**:

```
-- Without composite index (sequential scan on 10M-row table):
Gather (cost=1000.00..45000.00 rows=5000 width=250)
  -> Parallel Seq Scan on transactions (cost=0.00..44000.00 rows=5000 width=250)
       Filter: ((status = 'COMPLETED') AND (initiated_at > '2024-01-01'))
Planning time: 0.8ms  Execution time: 1240ms

-- With composite index idx_txn_status_initiated_at:
Index Scan using idx_txn_status_initiated_at on transactions
  (cost=0.43..125.00 rows=100 width=250)
  Index Cond: ((status = 'COMPLETED') AND (initiated_at > '2024-01-01'))
Planning time: 0.4ms  Execution time: 2.3ms
```

Performance improvement: 540x on a 10M-row table.

#### Table: `transaction_audit`

```sql
-- Supports: "all audit records for transaction X" (dispute investigation, compliance)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txn_audit_transaction_id
    ON transactions.transaction_audit(transaction_id);

-- Supports: "audit records in time window" (compliance export, period reports)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txn_audit_recorded_at
    ON transactions.transaction_audit(recorded_at DESC);
```

#### Table: `transaction_status_history`

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txn_status_history_transaction_id
    ON transactions.transaction_status_history(transaction_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txn_status_history_transitioned_at
    ON transactions.transaction_status_history(transitioned_at DESC);
```

#### Table: `saga_state`

```sql
-- Enforced by UNIQUE constraint; primary lookup for the saga orchestrator
CREATE UNIQUE INDEX uq_saga_state_transaction_id
    ON transactions.saga_state(transaction_id);

-- Supports: "get all IN_PROGRESS sagas" (crash recovery after service restart)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_saga_status
    ON transactions.saga_state(saga_status);
```

The saga orchestrator's crash recovery query is:

```sql
SELECT * FROM transactions.saga_state
WHERE saga_status IN ('STARTED', 'IN_PROGRESS', 'COMPENSATING')
ORDER BY created_at ASC;
```

Without `idx_saga_status`, a full table scan is required. At peak load with 10,000 in-flight transactions, this index reduces recovery scan time from approximately 500ms to under 1ms.

#### Table: `outbox_events` (transactions schema)

```sql
-- Same rationale as account-service outbox; partial index is critical for relay performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txn_outbox_pending
    ON transactions.outbox_events(created_at ASC)
    WHERE status = 'PENDING';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txn_outbox_failed
    ON transactions.outbox_events(created_at DESC)
    WHERE status = 'FAILED';

-- Supports relay partitioning: fetch PENDING events for a specific Kafka partition key range
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txn_outbox_partition_key_pending
    ON transactions.outbox_events(partition_key, created_at ASC)
    WHERE status = 'PENDING';
```

---

### fraud-service Indexes

**Schema**: `fraud`

#### Table: `fraud_alerts`

```sql
-- Supports: "get fraud alert for transaction X" (cross-service correlation in investigations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fraud_alerts_transaction_id
    ON fraud.fraud_alerts(transaction_id);

-- Supports: "all fraud alerts on account X" (account risk profile view)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fraud_alerts_account_id
    ON fraud.fraud_alerts(account_id);

-- Supports: "all HIGH and CRITICAL alerts pending review" (analyst priority queue)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fraud_alerts_risk_level
    ON fraud.fraud_alerts(risk_level);

-- Supports: "all alerts with REVIEW decision" (manual review queue)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fraud_alerts_decision
    ON fraud.fraud_alerts(decision);

-- Supports: "alerts created in last 24 hours" (real-time monitoring dashboard)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fraud_alerts_created_at
    ON fraud.fraud_alerts(created_at DESC);

-- Composite partial: analyst queue sorted by risk level and recency, only REVIEW decisions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fraud_alerts_review_queue
    ON fraud.fraud_alerts(risk_level, created_at DESC)
    WHERE decision = 'REVIEW';

-- GIN index for querying specific rule names within the triggered_rules JSON array
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fraud_alerts_triggered_rules_gin
    ON fraud.fraud_alerts USING GIN(triggered_rules);
```

**GIN index usage for rule-based queries**:

```sql
-- "Which alerts were triggered by the VELOCITY_CHECK rule in the last 7 days?"
SELECT id, transaction_id, risk_score, decision
FROM fraud.fraud_alerts
WHERE triggered_rules @> '[{"rule_name": "VELOCITY_CHECK"}]'::jsonb
  AND created_at > now() - interval '7 days';
-- Uses idx_fraud_alerts_triggered_rules_gin combined with idx_fraud_alerts_created_at
```

---

### notification-service Indexes

**Schema**: `notifications`

#### Table: `notifications`

```sql
-- Supports: "all notifications for recipient X" (customer notification inbox)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_recipient_id
    ON notifications.notifications(recipient_id);

-- Supports: "all PENDING notifications" (delivery worker pickup queue)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_status
    ON notifications.notifications(status);

-- Supports: "notifications by channel" (SMS delivery status, email bounce analysis)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_channel
    ON notifications.notifications(channel);

-- Supports: "notifications in date range" (operational reporting)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_created_at
    ON notifications.notifications(created_at DESC);

-- Supports: "all notifications linked to transaction X" (customer support lookup)
-- Partial because reference_id is often NULL for system-generated notifications
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_reference_id
    ON notifications.notifications(reference_id)
    WHERE reference_id IS NOT NULL;

-- Partial: retry worker only needs FAILED rows with remaining retry budget.
-- Dramatically reduces scan cost as SENT rows vastly outnumber FAILED over time.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_retry_eligible
    ON notifications.notifications(created_at ASC)
    WHERE status = 'FAILED' AND retry_count < 3;

-- Composite: recipient inbox query (newest first, filtered by status)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_recipient_status_created
    ON notifications.notifications(recipient_id, status, created_at DESC);
```

**Retry worker query served by the partial index**:

```sql
-- Runs every 30 seconds to pick up notifications eligible for retry
SELECT id, recipient_id, channel, payload, retry_count
FROM notifications.notifications
WHERE status = 'FAILED'
  AND retry_count < 3
ORDER BY created_at ASC
LIMIT 50
FOR UPDATE SKIP LOCKED;
-- Uses idx_notifications_retry_eligible (partial index on the tiny FAILED+eligible subset)
-- Without partial index on a 50M-row table: 8+ seconds. With it: under 5ms.
```

---

### audit-service Indexes

**Schema**: `audit`

#### Table: `audit_logs`

The `audit_logs` table is write-heavy (all services emit to it) and read occasionally (compliance queries, investigations). Indexes are kept to the minimum needed for compliance query patterns to protect write throughput.

```sql
-- Supports: "all actions on resource X" (account audit trail, dispute resolution)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_resource_id
    ON audit.audit_logs(resource_id);

-- Supports: "all actions by actor X" (staff activity review, insider threat detection)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_actor_id
    ON audit.audit_logs(actor_id);

-- Supports: "all events of type X" (compliance report: all ACCOUNT_CLOSED events)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_event_type
    ON audit.audit_logs(event_type);

-- Supports: "all CRITICAL severity events" (security incident investigation)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_severity
    ON audit.audit_logs(severity);

-- Supports: "events in time range" (the most common compliance query pattern)
-- DESC because compliance queries almost always request newest records first
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_occurred_at
    ON audit.audit_logs(occurred_at DESC);

-- Supports: "all events emitted by fraud-service" (service-specific audit export)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_source_service
    ON audit.audit_logs(source_service);

-- Partial: correlation_id lookup only relevant when the column is populated
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_correlation_id
    ON audit.audit_logs(correlation_id)
    WHERE correlation_id IS NOT NULL;

-- Composite: most common compliance query pattern
-- "All actions on resource X, newest first"
-- Eliminates Sort node; index-only scan possible if only these columns are selected
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_resource_occurred_at
    ON audit.audit_logs(resource_id, occurred_at DESC);

-- GIN on metadata for ad-hoc security queries (IP address, session ID lookups)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_metadata_gin
    ON audit.audit_logs USING GIN(metadata);
```

**Compliance query using the composite index**:

```sql
-- "All actions on account 3e4a5b6c-... in Q1 2024, newest first"
EXPLAIN ANALYZE
SELECT event_type, actor_id, action, description, occurred_at
FROM audit.audit_logs
WHERE resource_id = '3e4a5b6c-7d8e-9f0a-b1c2-d3e4f5a6b7c8'
  AND occurred_at BETWEEN '2024-01-01' AND '2024-03-31'
ORDER BY occurred_at DESC;

-- Plan output (with index):
Index Scan using idx_audit_resource_occurred_at on audit_logs
  (cost=0.56..48.00 rows=24 width=320)
  Index Cond: ((resource_id = '3e4a5b6c-...') AND
               (occurred_at >= '2024-01-01') AND
               (occurred_at <= '2024-03-31'))
Planning time: 0.3ms  Execution time: 0.8ms
```

---

## JSONB Indexing

JSONB columns appear in several tables. The indexing strategy differs based on query pattern and frequency.

### GIN Indexes (for containment and existence queries)

GIN (Generalized Inverted Index) indexes support JSONB operators `@>` (contains), `?` (key exists), `?|` (any key exists), and `?&` (all keys exist).

| Table        | Column          | Index Name                           | Use Case                                               |
|--------------|-----------------|--------------------------------------|--------------------------------------------------------|
| fraud_alerts | triggered_rules | idx_fraud_alerts_triggered_rules_gin | Filter by specific fraud rule name within JSON array   |
| transactions | metadata        | idx_txn_metadata_gin                 | Filter by channel, device_type, or any metadata key    |
| audit_logs   | metadata        | idx_audit_metadata_gin               | Filter by IP address or session ID in security reviews |

```sql
-- GIN index creation
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txn_metadata_gin
    ON transactions.transactions USING GIN(metadata);

-- Query using idx_txn_metadata_gin
SELECT id, reference_number, amount
FROM transactions.transactions
WHERE metadata @> '{"channel": "mobile"}'::jsonb
  AND initiated_at > now() - interval '7 days';
```

### Expression Indexes (for specific key extraction)

When a single JSON key is queried repeatedly with equality, a functional index on the extracted text value outperforms GIN because it produces a smaller, more selective B-tree:

```sql
-- Functional index on a specific JSONB key
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txn_metadata_channel
    ON transactions.transactions ((metadata->>'channel'));

-- Query plan uses this index efficiently for single-key equality
SELECT * FROM transactions.transactions
WHERE metadata->>'channel' = 'mobile'
  AND initiated_at > now() - interval '1 hour';
-- Index Scan on idx_txn_metadata_channel; much smaller than GIN for equality-only queries
```

### JSONB Columns Without Indexes

Not all JSONB columns require indexes. Columns that are never filtered on in WHERE clauses do not benefit from indexing:

| Table          | Column          | Reason No Index Needed                                              |
|----------------|-----------------|---------------------------------------------------------------------|
| outbox_events  | payload         | Rows fetched by status + created_at; payload read after retrieval   |
| saga_state     | step_data       | Looked up by transaction_id; step_data deserialized after retrieval |
| audit_logs     | old_value       | Compliance snapshots fetched by row; not used as filter criteria    |
| audit_logs     | new_value       | Same as old_value                                                   |
| notifications  | payload         | Notification worker fetches rows by status; payload not filtered on |

---

## Composite Index Rationale

A composite index on `(A, B)` can serve queries filtering on:

- `A` alone (leftmost-prefix rule: PostgreSQL can use the index with only the leading column).
- `A` and `B` together (full index scan with both predicates pushed down).
- It **cannot** serve queries filtering on `B` alone; those require a separate index on `B`.

**When to prefer composite over separate indexes**:

1. **Query always provides both columns**: `transactions(status, initiated_at)` — account statement queries always supply a status filter and a date range. Both columns in one index avoids maintaining two separate B-trees.
2. **Sort elimination**: If the query's `ORDER BY` matches the composite index column order and direction, PostgreSQL skips the Sort node entirely, which is significant for paginated queries returning millions of candidate rows.
3. **Index-only scans**: If the SELECT clause references only columns in the composite index (plus the heap TID), PostgreSQL returns results from the index without touching the table, dramatically reducing I/O for summary queries.

**When to keep separate indexes**:

1. **Independent access patterns**: `status` queried alone (operations queue) AND `initiated_at` queried alone (time-range export) both need efficient access. A composite `(status, initiated_at)` cannot serve the `initiated_at`-only query efficiently, so a separate `idx_txn_initiated_at` is maintained alongside the composite.
2. **Very high cardinality second column**: If `B` has near-unique cardinality, the composite index becomes as large as a full table scan for `B`-only queries; a separate index on `B` alone is more space-efficient.

---

## Partial Indexes

Partial indexes index only the rows satisfying a WHERE clause. They are the most powerful single optimization available for tables where a small "hot" subset exists among a large "cold" majority.

**All partial indexes in this system**:

| Table               | Schema        | Index Name                          | Filter                              | Hot Subset Size |
|---------------------|---------------|-------------------------------------|-------------------------------------|-----------------|
| outbox_events       | accounts      | idx_acc_outbox_pending              | status = 'PENDING'                  | ~0.1% of table  |
| outbox_events       | accounts      | idx_acc_outbox_failed               | status = 'FAILED'                   | ~0.5% of table  |
| outbox_events       | transactions  | idx_txn_outbox_pending              | status = 'PENDING'                  | ~0.1% of table  |
| outbox_events       | transactions  | idx_txn_outbox_partition_key_pending| status = 'PENDING'                  | ~0.1% of table  |
| notifications       | notifications | idx_notifications_retry_eligible    | status='FAILED' AND retry_count < 3 | ~1% of table    |
| notifications       | notifications | idx_notifications_reference_id      | reference_id IS NOT NULL            | ~60% of table   |
| fraud_alerts        | fraud         | idx_fraud_alerts_review_queue       | decision = 'REVIEW'                 | ~5% of table    |
| audit_logs          | audit         | idx_audit_correlation_id            | correlation_id IS NOT NULL          | ~70% of table   |

---

## Index Maintenance

### Monitoring Index Usage

Run monthly to identify candidates for removal:

```sql
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname IN ('accounts','transactions','fraud','notifications','audit')
ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC;
```

Indexes with `idx_scan = 0` after 30+ days of production traffic are candidates for removal. Confirm with the team before dropping; some indexes exist for constraint enforcement (unique indexes) rather than query optimization.

### Detecting Index Bloat

B-tree indexes accumulate dead entries when rows are updated or deleted. Check for bloat periodically:

```sql
SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
    round(100.0 * pg_relation_size(indexrelid) /
          nullif(pg_relation_size(indrelid), 0), 2) AS index_to_table_pct
FROM pg_stat_user_indexes
JOIN pg_index USING (indexrelid)
WHERE schemaname IN ('accounts','transactions','fraud','notifications','audit')
ORDER BY pg_relation_size(indexrelid) DESC;
```

An `index_to_table_pct` above 50% for a non-unique index on a high-churn table warrants investigation.

### Rebuilding Bloated Indexes

```sql
-- Rebuild a specific index without locking the table
REINDEX INDEX CONCURRENTLY accounts.idx_accounts_status;

-- Rebuild all indexes on a table without locking
REINDEX TABLE CONCURRENTLY accounts.accounts;
```

Schedule `REINDEX CONCURRENTLY` during low-traffic windows (02:00–04:00 UTC). Monitor progress:

```sql
SELECT phase, blocks_done, blocks_total,
       round(100.0 * blocks_done / nullif(blocks_total, 0), 1) AS pct_done
FROM pg_stat_progress_create_index;
```

### Autovacuum Tuning for High-Write Tables

For tables with high INSERT+DELETE rates (outbox_events, audit_logs), tune autovacuum more aggressively than the PostgreSQL default to reclaim dead index entries before bloat becomes significant:

```sql
-- outbox_events: high turnover (PENDING → PUBLISHED → deleted)
ALTER TABLE accounts.outbox_events SET (
    autovacuum_vacuum_scale_factor = 0.01,   -- vacuum at 1% dead rows (default 20%)
    autovacuum_analyze_scale_factor = 0.01,
    autovacuum_vacuum_cost_delay = 2          -- milliseconds
);

ALTER TABLE transactions.outbox_events SET (
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_analyze_scale_factor = 0.01,
    autovacuum_vacuum_cost_delay = 2
);

-- audit_logs: append-only in practice; lower vacuum frequency acceptable
ALTER TABLE audit.audit_logs SET (
    autovacuum_vacuum_scale_factor = 0.02,
    autovacuum_analyze_scale_factor = 0.02
);
```

---

## Query Pattern Analysis

This section documents the primary query patterns driving each index decision.

| Query Pattern                                    | Service              | Index Used                              | Frequency    |
|--------------------------------------------------|----------------------|-----------------------------------------|--------------|
| Account lookup by customer_id                    | account-service      | idx_accounts_customer_id                | Very high    |
| Account statement (paginated by status + date)   | transaction-service  | idx_txn_status_initiated_at (composite) | Very high    |
| Outbox relay (fetch PENDING events)              | account/txn service  | idx_*_outbox_pending (partial)          | Continuous   |
| Saga crash recovery (fetch non-terminal sagas)   | transaction-service  | idx_saga_status                         | On restart   |
| Fraud analyst queue (REVIEW decisions by risk)   | fraud-service        | idx_fraud_alerts_review_queue (partial) | High         |
| Notification retry (FAILED + eligible rows)      | notification-service | idx_notifications_retry_eligible        | Every 30s    |
| Compliance audit trail (resource + date range)   | audit-service        | idx_audit_resource_occurred_at          | Low, critical|
| Cross-service incident correlation               | audit-service        | idx_audit_correlation_id (partial)      | Low          |
| Fraud rule analysis (specific rule in JSONB)     | fraud-service        | idx_fraud_alerts_triggered_rules_gin    | Medium       |
| Transaction metadata search (channel, device)    | transaction-service  | idx_txn_metadata_gin                    | Low-medium   |

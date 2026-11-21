# Runbook: Stuck Saga Recovery

**Symptom:** transactions stay in `PENDING` or `PROCESSING` for minutes; customers see "processing";
`saga_states` rows stay in `AWAITING_FRAUD_CHECK` / `AWAITING_BALANCE_UPDATE`.

Background: [saga-pattern](../architecture/saga-pattern.md). The saga timeout job fails sagas in
`AWAITING_FRAUD_CHECK` / `AWAITING_BALANCE_UPDATE` after `saga.timeout-minutes` (default 15).
`AWAITING_REVIEW` is never timed out — it waits for an admin.

> Table and column names below follow the design in [schema-overview](../database/schema-overview.md);
> check `transaction-service/src/main/resources/db/migration/V1__create_transactions_schema.sql` if a
> name differs.

```bash
COMPOSE="docker compose -f docker/docker-compose.yml"
$COMPOSE exec postgres psql -U banking -d transactions_db
```

## 1. Find the stuck sagas

```sql
SELECT s.transaction_id, s.status, s.current_step, s.retry_count, s.updated_at,
       t.reference, t.status AS txn_status, t.transaction_type, t.amount
FROM saga_states s JOIN transactions t ON t.id = s.transaction_id
WHERE s.status IN ('AWAITING_FRAUD_CHECK', 'AWAITING_BALANCE_UPDATE', 'AWAITING_REVIEW')
ORDER BY s.updated_at;
```

Or per transaction (admin token): `GET /api/v1/transactions/{id}/saga` and
`GET /api/v1/audit/logs/correlation/{transactionId}`.

## 2. Diagnose by state

### A. Stuck in `AWAITING_FRAUD_CHECK`

The fraud reply has not arrived. Check in this order:

1. **Was `TRANSACTION_INITIATED` published?**
   ```sql
   SELECT status, attempts, last_error, created_at, published_at
   FROM outbox_events WHERE aggregate_id = '<transactionId>' ORDER BY created_at;
   ```
   - `PENDING` and old → relay not running or Kafka unreachable → [outbox-backlog-recovery](outbox-backlog-recovery.md).
   - `FAILED` → same runbook.
2. **Did fraud-service consume it?** Check consumer lag for group `fraud-service`
   ([kafka-consumer-lag](kafka-consumer-lag.md)) and fraud-service logs for the transaction id.
3. **Is it in a DLT?** Look in `banking.transaction.events.DLT` ([dlq-reprocessing](dlq-reprocessing.md)).
4. **Did fraud-service decide but not publish?**
   ```sql
   -- fraud_db
   SELECT decision, risk_score, evaluated_at FROM fraud_decisions WHERE transaction_id = '<transactionId>';
   ```
   A decision exists but no fraud event in `banking.fraud.events` → re-deliver `TRANSACTION_INITIATED`
   (replay the outbox row, see section 3) — fraud-service re-publishes for an existing decision.

### B. Stuck in `AWAITING_REVIEW`

Expected — an admin must act. List open alerts: `GET /api/v1/fraud/alerts?status=OPEN`, then
`POST /api/v1/fraud/alerts/{id}/review` with `{"decision":"APPROVE"}` or `{"decision":"REJECT"}`.
If the alert is already APPROVED/REJECTED but the saga is still waiting, the fraud event was lost:
check `banking.fraud.events` and the consumer group `transaction-service`.

### C. Stuck in `AWAITING_BALANCE_UPDATE`

1. Was `BALANCE_UPDATE_REQUESTED` published from transactions_db outbox? (same query as A.1)
2. Did account-service consume it? Lag of group `account-service`; DLT `banking.transaction.events.DLT`.
3. **Did account-service apply it?** In accounts_db look for the ledger/processed row with this
   `transaction_id` and the outbox row:
   ```sql
   -- accounts_db
   SELECT event_type, status, attempts, last_error, created_at
   FROM outbox_events WHERE aggregate_id = '<transactionId>';
   ```
   - Outbox `BALANCE_UPDATED` / `BALANCE_UPDATE_FAILED` is `PENDING`/`FAILED` → fix the account-service
     relay ([outbox-backlog-recovery](outbox-backlog-recovery.md)); the saga continues by itself.
   - Row `PUBLISHED` → transaction-service did not consume it: check group `transaction-service` lag
     and `banking.account.events.DLT`.
   - No row → account-service never processed the request: re-deliver `BALANCE_UPDATE_REQUESTED`.

## 3. Re-deliver an event (safe, idempotent)

Re-sending an outbox row: set it back to `PENDING`; the relay sends it within ~2 s.

```sql
UPDATE outbox_events
SET status = 'PENDING', attempts = 0, last_error = NULL
WHERE aggregate_id = '<transactionId>' AND event_type = '<EVENT_TYPE>';
```

All consumers deduplicate by `eventId` / `transactionId`, so a duplicate is harmless.

## 4. Let the timeout fail it

If the downstream problem cannot be fixed quickly, the timeout job will mark the saga `FAILED`
(failureCode `TRANSACTION_FAILED`, reason "Saga timed out") and publish `TRANSACTION_FAILED`;
the customer is notified. To test the job sooner in a non-production environment, lower
`saga.timeout-minutes` (`SAGA_TIMEOUTMINUTES`) and restart transaction-service.

## 5. Danger: timed out but money moved

If a saga timed out in `AWAITING_BALANCE_UPDATE` and **later** account-service's `BALANCE_UPDATED`
arrives, transaction-service ignores it (saga already FAILED) and logs a warning. Now the balances
changed but the transaction says FAILED. Detect it:

```sql
-- transactions_db: failed by timeout
SELECT id, reference, amount FROM transactions
WHERE status = 'FAILED' AND failure_reason = 'Saga timed out';
```

For each id, check accounts_db for a ledger row with that `transaction_id`. If one exists:

1. Treat as **SEV1** ([incident-response](incident-response.md)).
2. Do not edit balances by hand. Decide with the business owner: reverse the movement with a
   compensating transaction (e.g. an admin transfer back) **or** correct the transaction record to
   `COMPLETED` with a documented manual change (status history row with reason).
3. Root cause is usually a long outbox/Kafka outage; consider increasing `saga.timeout-minutes`.

## 6. Verify

```sql
SELECT status, count(*) FROM saga_states GROUP BY status;
```

No sagas older than the timeout in non-terminal states (except `AWAITING_REVIEW`).

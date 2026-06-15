# Saga Stuck Recovery Runbook

**Banking Platform — On-Call Operations Guide**
Last Updated: 2026-06-15 | Owner: Platform Engineering

---

## Table of Contents

1. [What Is a Stuck Saga](#what-is-a-stuck-saga)
2. [Detection](#detection)
3. [Step 1 — Identify the Stuck Transaction](#step-1-identify-the-stuck-transaction)
4. [Step 2 — Find the Missing Event](#step-2-find-the-missing-event)
5. [Step 3 — Check DLT for the Missing Event](#step-3-check-dlt-for-the-missing-event)
6. [Step 4 — Per-Step Recovery Procedures](#step-4-per-step-recovery-procedures)
7. [Step 5 — Manual Saga Advancement (Last Resort)](#step-5-manual-saga-advancement)
8. [Validation](#validation)
9. [Prevention](#prevention)
10. [Saga State Reference](#saga-state-reference)

---

## What Is a Stuck Saga

The banking platform uses the **Saga pattern** to coordinate multi-step distributed transactions across services. A `SagaState` record in `transactions.saga_state` tracks each transaction's progress through the saga.

### Normal Saga Flow

```
STARTED
  → FRAUD_CHECK_SENT        (transaction.initiated published → fraud-service consuming)
  → FRAUD_CHECK_COMPLETED   (fraud.decision received → APPROVED)
  → BALANCE_RESERVED        (balance.reserve.requested published → account-service consuming)
  → DEBIT_COMPLETED         (balance.reserved received → debit applied)
  → CREDIT_INITIATED        (credit.initiated published → account-service consuming)
  → COMPLETED               (credit.completed received)

On failure path:
  → COMPENSATING            (compensation triggered)
  → COMPENSATION_DEBIT_REVERSED  (debit reversed if already applied)
  → FAILED                  (saga ended in failure, all compensations done)
```

### What Makes a Saga "Stuck"

A saga is considered stuck when its `saga_status` is `STARTED` or `COMPENSATING` and `updated_at` has not changed in more than **30 minutes**. This means the saga is waiting for an event that never arrived.

**Root causes:**
- The expected Kafka event was published to a DLT (failed processing)
- The upstream service crashed before publishing the next event
- Kafka consumer lag prevented the event from being consumed
- A network partition isolated a service temporarily
- A bug caused the event to be dropped silently

> **Business Impact:** A stuck saga means a customer's transaction is in an indeterminate state — money may be reserved but not moved, or a debit applied but credit not yet done. These must be resolved within SLA.

---

## Detection

### Prometheus Alert

```
Alert: SagaStuckDuration
Condition: saga_stuck_count > 0 for 30 minutes
Severity: SEV2
```

The `saga_stuck_count` metric is exported by transaction-service via:
```
GET http://localhost:8082/actuator/metrics/saga.stuck.count
```

### Manual Detection Query

Run this query on the `transaction_db` PostgreSQL instance:

```sql
SELECT
    transaction_id,
    current_step,
    saga_status,
    created_at,
    updated_at,
    NOW() - updated_at AS stuck_duration,
    source_account_id,
    target_account_id,
    amount
FROM transactions.saga_state
WHERE saga_status IN ('STARTED', 'COMPENSATING')
  AND updated_at < NOW() - INTERVAL '30 minutes'
ORDER BY updated_at ASC;
```

**Expected output when healthy:** No rows returned.

**Output indicating stuck sagas:**
```
 transaction_id                       | current_step        | saga_status | created_at          | updated_at          | stuck_duration | source_account_id | amount
--------------------------------------+---------------------+-------------+---------------------+---------------------+----------------+-------------------+--------
 a1b2c3d4-e5f6-7890-abcd-ef1234567890 | FRAUD_CHECK_SENT    | STARTED     | 2026-06-15 14:00:00 | 2026-06-15 14:02:00 | 00:48:00       | ACC-001           | 500.00
 b2c3d4e5-f6a7-8901-bcde-f12345678901 | BALANCE_RESERVED    | STARTED     | 2026-06-15 13:55:00 | 2026-06-15 13:58:00 | 00:52:00       | ACC-002           | 1200.00
```

---

## Step 1 — Identify the Stuck Transaction

```sql
-- Full detail for a specific stuck transaction
SELECT
    ss.transaction_id,
    ss.current_step,
    ss.saga_status,
    ss.created_at,
    ss.updated_at,
    NOW() - ss.updated_at AS stuck_duration,
    t.source_account_id,
    t.target_account_id,
    t.amount,
    t.currency,
    t.status AS transaction_status,
    t.description
FROM transactions.saga_state ss
JOIN transactions.transactions t ON t.id = ss.transaction_id
WHERE ss.transaction_id = '{transaction_id}';
```

```sql
-- Check the full saga event history for this transaction
SELECT
    event_type,
    event_payload,
    created_at,
    status
FROM transactions.outbox_events
WHERE aggregate_id = '{transaction_id}'
ORDER BY created_at ASC;
```

This gives you a clear picture of:
1. What step the saga was last at
2. What events were published (outbox)
3. Whether the outbox relay sent the event to Kafka

---

## Step 2 — Find the Missing Event

Based on `current_step`, determine what event was expected next but never arrived:

| current_step | Expected Incoming Event | Published By | Consumed By |
|-------------|------------------------|-------------|-------------|
| `FRAUD_CHECK_SENT` | `fraud.decision` | fraud-service | transaction-service |
| `FRAUD_CHECK_COMPLETED` | `balance.reserved` | account-service | transaction-service |
| `BALANCE_RESERVED` | (internal: debit applied) | transaction-service internal | — |
| `DEBIT_COMPLETED` | `credit.completed` | account-service | transaction-service |
| `CREDIT_INITIATED` | `credit.completed` | account-service | transaction-service |
| `COMPENSATING` | compensation ack event | depends on step | transaction-service |

### Check If the Event Was Published

```bash
# Search Kafka topic for the specific transaction_id
# Replace TOPIC and TRANSACTION_ID accordingly
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic fraud.decision \
  --from-beginning \
  --property print.key=true \
  | grep "{transaction_id}"
```

```sql
-- Check if the upstream service published to its outbox
-- Run on account_db for account-service events
SELECT *
FROM accounts.outbox_events
WHERE aggregate_id = '{transaction_id}'
ORDER BY created_at DESC;
```

---

## Step 3 — Check DLT for the Missing Event

If the event was published to Kafka but processing failed, it may be in a DLT.

```bash
# Check fraud.decision DLT for the stuck transaction
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic fraud.decision.DLT \
  --from-beginning \
  --property print.headers=true \
  --property print.key=true \
  | grep -A5 "{transaction_id}"
```

```bash
# Check all DLTs for the transaction
for topic in fraud.decision.DLT balance.reserved.DLT credit.completed.DLT; do
  echo "=== Checking $topic ==="
  kafka-console-consumer.sh \
    --bootstrap-server localhost:9092 \
    --topic $topic \
    --from-beginning \
    --max-messages 100 \
    --property print.key=true \
    --timeout-ms 5000 \
  | grep "{transaction_id}" && echo "FOUND IN $topic" || echo "Not in $topic"
done
```

If found in a DLT → the event failed processing. Check the DLT headers for the exception:

```bash
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic fraud.decision.DLT \
  --from-beginning \
  --max-messages 50 \
  --property print.headers=true \
  | grep -E "kafka_exceptionMessage|kafka_exceptionFqcn|{transaction_id}"
```

> For full DLT replay instructions, see `docs/runbooks/dlq-reprocessing.md`.

---

## Step 4 — Per-Step Recovery Procedures

### Stuck at FRAUD_CHECK_SENT

**Meaning:** `transaction.initiated` was sent to fraud-service, but `fraud.decision` never came back.

**Likely causes:**
- fraud-service is down or restarting
- fraud-service consumer has lag
- fraud-service published decision but it went to DLT in transaction-service

**Recovery — re-trigger fraud check:**

```bash
# Option A: Re-publish transaction.initiated event for the specific transaction
# Get the original event payload from the outbox
psql -h localhost -U postgres -d transaction_db -c "
  SELECT event_payload
  FROM transactions.outbox_events
  WHERE aggregate_id = '{transaction_id}'
    AND event_type = 'TRANSACTION_INITIATED'
  ORDER BY created_at DESC
  LIMIT 1;" -t | \
kafka-console-producer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated \
  --property "parse.key=false"
```

```bash
# Option B: If event not in outbox, re-insert to outbox for relay to pick up
psql -h localhost -U postgres -d transaction_db -c "
  INSERT INTO transactions.outbox_events
    (id, aggregate_id, event_type, event_payload, status, retry_count, created_at)
  SELECT
    gen_random_uuid(),
    '{transaction_id}',
    'TRANSACTION_INITIATED',
    event_payload,
    'PENDING',
    0,
    NOW()
  FROM transactions.outbox_events
  WHERE aggregate_id = '{transaction_id}'
    AND event_type = 'TRANSACTION_INITIATED'
  ORDER BY created_at DESC
  LIMIT 1;"
```

### Stuck at BALANCE_RESERVED

**Meaning:** Fraud approved, and account-service reserved the balance, but the saga did not advance to apply the debit.

**Likely causes:**
- `balance.reserved` event went to DLT in transaction-service
- transaction-service was restarting at time of event arrival

**Recovery — manually trigger the debit step:**

```bash
# Check account-service to confirm balance IS reserved
psql -h localhost -U postgres -d account_db -c "
  SELECT account_id, reserved_amount, balance
  FROM accounts.accounts
  WHERE account_id = (
    SELECT source_account_id FROM transactions.transactions WHERE id = '{transaction_id}'
  );"
```

```bash
# Re-publish the balance.reserved event from account-service outbox
psql -h localhost -U postgres -d account_db -c "
  SELECT event_payload
  FROM accounts.outbox_events
  WHERE aggregate_id = '{transaction_id}'
    AND event_type = 'BALANCE_RESERVED'
  ORDER BY created_at DESC
  LIMIT 1;" -t | \
kafka-console-producer.sh \
  --bootstrap-server localhost:9092 \
  --topic balance.reserved \
  --property "parse.key=false"
```

If balance was NOT reserved (account-service never processed it):

```sql
-- Trigger compensation: release whatever reservation exists and fail the saga
-- First, update saga to trigger compensation flow
UPDATE transactions.saga_state
SET saga_status = 'COMPENSATING',
    current_step = 'COMPENSATION_BALANCE_RELEASE_REQUESTED',
    updated_at = NOW()
WHERE transaction_id = '{transaction_id}';
```

Then publish a balance release event (see compensation section below).

### Stuck at DEBIT_COMPLETED

**Meaning:** Debit was applied to source account, but credit to target account was not completed.

> **Critical:** Money has left the source account. The target account has NOT been credited. This is the most dangerous stuck state — resolve immediately.

```bash
# Confirm debit WAS applied
psql -h localhost -U postgres -d account_db -c "
  SELECT account_id, balance, reserved_amount
  FROM accounts.accounts
  WHERE account_id = (
    SELECT source_account_id FROM transactions.transactions WHERE id = '{transaction_id}'
  );"

# Check if credit.initiated was published
psql -h localhost -U postgres -d transaction_db -c "
  SELECT event_type, status, created_at
  FROM transactions.outbox_events
  WHERE aggregate_id = '{transaction_id}'
  ORDER BY created_at ASC;"
```

**Recovery — re-publish credit.initiated:**

```bash
psql -h localhost -U postgres -d transaction_db -c "
  SELECT event_payload
  FROM transactions.outbox_events
  WHERE aggregate_id = '{transaction_id}'
    AND event_type = 'CREDIT_INITIATED'
  ORDER BY created_at DESC
  LIMIT 1;" -t | \
kafka-console-producer.sh \
  --bootstrap-server localhost:9092 \
  --topic credit.initiated \
  --property "parse.key=false"
```

If `credit.initiated` was never written to outbox, insert it manually:

```sql
-- Build the credit event payload and insert to outbox
-- ONLY after confirming debit was applied and credit was not
INSERT INTO transactions.outbox_events
  (id, aggregate_id, event_type, event_payload, status, retry_count, created_at)
VALUES (
  gen_random_uuid(),
  '{transaction_id}',
  'CREDIT_INITIATED',
  '{"transactionId": "{transaction_id}", "targetAccountId": "{target_account_id}", "amount": {amount}, "currency": "{currency}"}',
  'PENDING',
  0,
  NOW()
);
```

### Stuck in COMPENSATING

**Meaning:** A compensation was triggered but did not complete. Compensation events were published but not acknowledged.

```sql
-- Check compensation progress
SELECT event_type, status, created_at
FROM transactions.outbox_events
WHERE aggregate_id = '{transaction_id}'
  AND event_type LIKE 'COMPENSATION%'
ORDER BY created_at ASC;
```

```bash
# Check if balance release event was consumed by account-service
psql -h localhost -U postgres -d account_db -c "
  SELECT account_id, balance, reserved_amount
  FROM accounts.accounts
  WHERE account_id = (
    SELECT source_account_id FROM transactions.transactions WHERE id = '{transaction_id}'
  );"
```

If balance is still reserved (release not applied):

```bash
# Re-publish compensation event
psql -h localhost -U postgres -d transaction_db -c "
  SELECT event_payload
  FROM transactions.outbox_events
  WHERE aggregate_id = '{transaction_id}'
    AND event_type = 'BALANCE_RELEASE_REQUESTED'
  ORDER BY created_at DESC
  LIMIT 1;" -t | \
kafka-console-producer.sh \
  --bootstrap-server localhost:9092 \
  --topic balance.release.requested \
  --property "parse.key=false"
```

---

## Step 5 — Manual Saga Advancement (Last Resort)

> **WARNING:** Only perform manual saga advancement when all other recovery methods have failed, after explicit approval from the IC (Incident Commander) and a senior engineer. Manual state changes bypass all business logic validation.

Document every manual change in the incident channel with timestamp and justification.

### Pre-Requisites Before Manual Advancement

- [ ] Confirmed the expected event will never arrive naturally
- [ ] Confirmed all automated retries are exhausted
- [ ] Confirmed current account balances are consistent with the target state
- [ ] Obtained IC approval
- [ ] Second engineer is reviewing each SQL statement

### Manual State Advancement

```sql
-- STEP A: Record current state for rollback reference
SELECT * FROM transactions.saga_state WHERE transaction_id = '{transaction_id}';
SELECT * FROM transactions.transactions WHERE id = '{transaction_id}';

-- STEP B: Advance saga to next step
-- Example: advance from FRAUD_CHECK_SENT to FRAUD_CHECK_COMPLETED (APPROVED)
BEGIN;

UPDATE transactions.saga_state
SET current_step = 'FRAUD_CHECK_COMPLETED',
    updated_at = NOW()
WHERE transaction_id = '{transaction_id}'
  AND saga_status = 'STARTED'
  AND current_step = 'FRAUD_CHECK_SENT';

-- Verify exactly 1 row updated
-- If 0 rows: state has changed — ROLLBACK and re-assess
-- If 1 row: proceed

COMMIT;
```

```sql
-- Advance to FAILED (force-terminate the saga without compensation)
-- Use ONLY when saga cannot be compensated and manual account adjustment has been done
BEGIN;

UPDATE transactions.saga_state
SET saga_status = 'FAILED',
    current_step = 'MANUALLY_TERMINATED',
    updated_at = NOW()
WHERE transaction_id = '{transaction_id}';

UPDATE transactions.transactions
SET status = 'FAILED',
    updated_at = NOW(),
    failure_reason = 'Manual termination by ops on 2026-06-15 — incident #INC-XXX'
WHERE id = '{transaction_id}';

COMMIT;
```

### Publish Event Manually to Advance Saga

After updating the DB state, publish the event that the saga is waiting for:

```bash
# Create a minimal valid event JSON and publish it
cat << 'EOF' | kafka-console-producer.sh \
  --bootstrap-server localhost:9092 \
  --topic fraud.decision \
  --property "parse.key=true" \
  --property "key.separator=|"
{transaction_id}|{"transactionId": "{transaction_id}", "decision": "APPROVED", "riskScore": 0, "reason": "Manual override by ops — incident INC-XXX"}
EOF
```

---

## Validation

After applying any recovery procedure, validate the saga completed correctly:

### 1. Confirm Saga Reached Terminal State

```sql
-- Should return COMPLETED or FAILED within 5 minutes of intervention
SELECT transaction_id, saga_status, current_step, updated_at
FROM transactions.saga_state
WHERE transaction_id = '{transaction_id}';
```

### 2. Confirm Transaction Status

```sql
SELECT id, status, source_account_id, target_account_id, amount, updated_at
FROM transactions.transactions
WHERE id = '{transaction_id}';
```

### 3. Verify Account Balances Are Consistent

```sql
-- Run on account_db
-- Verify source account balance was reduced by amount (if COMPLETED)
-- Verify source account balance was restored (if FAILED/COMPENSATED)
SELECT account_id, balance, reserved_amount
FROM accounts.accounts
WHERE account_id IN ('{source_account_id}', '{target_account_id}');
```

### 4. Confirm No Orphaned Reservations

```sql
-- No remaining reserved_amount for this transaction's accounts
-- (reserved_amount should be 0 after saga completes either way)
SELECT account_id, reserved_amount
FROM accounts.accounts
WHERE account_id = '{source_account_id}'
  AND reserved_amount > 0;
```

> **Recovery declared complete** when: `saga_status` is `COMPLETED` or `FAILED`, transaction status matches, and account balances are consistent. Document the resolution in the incident channel.

---

## Prevention

### Saga Timeout Job

Configure the automated saga timeout job in transaction-service:

```yaml
# application.yml
saga:
  timeout:
    enabled: true
    check-interval-minutes: 5        # How often to scan for stuck sagas
    stuck-threshold-minutes: 30      # Sagas older than this are candidates
    auto-compensate-enabled: true    # Automatically trigger compensation
    max-auto-compensate-attempts: 3  # After N attempts, escalate to manual
```

The `SagaTimeoutJob` (annotated `@Scheduled`) runs every 5 minutes and:
1. Queries for sagas stuck > 30 minutes
2. For sagas in `STARTED`: publishes a timeout event to trigger compensation
3. For sagas in `COMPENSATING` > 60 minutes: fires a `SagaTimeoutAlert` metric

### Alerting

```yaml
# prometheus/alerts.yml
- alert: SagaStuck
  expr: saga_stuck_count > 0
  for: 30m
  labels:
    severity: warning
  annotations:
    summary: "{{ $value }} sagas stuck for > 30 minutes"
    runbook: "docs/runbooks/saga-stuck-recovery.md"

- alert: SagaStuckCritical
  expr: saga_stuck_count > 5
  for: 10m
  labels:
    severity: critical
  annotations:
    summary: "{{ $value }} sagas stuck — possible systemic failure"
```

---

## Saga State Reference

| saga_status | current_step | Meaning | Normal Duration |
|-------------|-------------|---------|----------------|
| STARTED | FRAUD_CHECK_SENT | Waiting for fraud decision | < 2 seconds |
| STARTED | FRAUD_CHECK_COMPLETED | Fraud approved, reserving balance | < 1 second |
| STARTED | BALANCE_RESERVED | Balance reserved, applying debit | < 1 second |
| STARTED | DEBIT_COMPLETED | Debit applied, initiating credit | < 1 second |
| STARTED | CREDIT_INITIATED | Waiting for credit confirmation | < 2 seconds |
| COMPLETED | CREDIT_COMPLETED | Saga finished successfully | — |
| COMPENSATING | COMPENSATION_* | Rolling back due to failure | < 10 seconds |
| FAILED | * | Saga ended in failure, compensated | — |

> **Total expected saga duration:** < 10 seconds end-to-end under normal load. Any saga older than 5 minutes without reaching a terminal state should be investigated.

---

## Related Runbooks

- `docs/runbooks/kafka-consumer-lag.md` — If saga is stuck due to consumer lag
- `docs/runbooks/dlq-reprocessing.md` — If saga event went to DLT
- `docs/runbooks/outbox-backlog-recovery.md` — If outbox relay is not publishing events
- `docs/runbooks/incident-response.md` — Overall incident response process

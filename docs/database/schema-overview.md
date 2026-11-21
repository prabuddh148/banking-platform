# Database Schema Overview

One PostgreSQL instance (`localhost:5432`, user `banking`) hosts **one database per service**
([ADR 0004](../adr/0004-postgresql-per-service.md)). Each schema is created and changed only by that
service's Flyway migrations (`<service>/src/main/resources/db/migration/V1__*.sql`).

This page describes the schemas at a **design level**. The migration files are the exact source of
truth for column types and constraint names.

Common conventions:
- Primary keys are `UUID`.
- Money columns are `NUMERIC(19,2)`; currency is a 3-letter code (`INR`, `USD`, `EUR`, `GBP`).
- Timestamps are `TIMESTAMPTZ` (stored in UTC).
- Enums are stored as `VARCHAR` (`@Enumerated(EnumType.STRING)`), often with a `CHECK` constraint.
- Ids that come from another service (user ids like `CUST-1001`, transaction ids in fraud_db) are
  plain `VARCHAR` — there are no cross-database foreign keys.
- Mutable rows that may be updated concurrently have a `version` column (JPA `@Version`).

---

## accounts_db (account-service)

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `accounts` | One row per bank account | `id`, `account_number` (UNIQUE, `ACC` + 10 digits), `customer_id`, `customer_name`, `customer_email`, `customer_phone`, `account_type` (SAVINGS/CURRENT/FIXED_DEPOSIT), `status` (ACTIVE/FROZEN/CLOSED), `currency`, `created_at`, `updated_at`, `version` |
| `account_balances` | Money for an account (1:1 with `accounts`), locked with `SELECT ... FOR UPDATE` during balance updates | `account_id` (PK/FK), `ledger_balance`, `reserved_amount`, `currency`, `last_updated`, `version`. `available = ledger_balance - reserved_amount` |
| `account_status_history` | Every status change (freeze, unfreeze, close) | `id`, `account_id` (FK), `previous_status`, `new_status`, `reason`, `changed_by`, `changed_at` |
| `balance_reservations` | Funds on hold (reserve/release endpoints), unique per (account, transaction) | `id`, `account_id`, `transaction_id`, `amount`, `status`, `created_at`, `closed_at` |
| `processed_transactions` | One row per handled `BALANCE_UPDATE_REQUESTED` (success or business failure); PK `transaction_id` makes the balance step idempotent | `transaction_id` (PK), `transaction_type`, `outcome`, `error_code`, `source_account_id`, `destination_account_id`, `amount`, `source_balance_after`, `destination_balance_after`, `processed_at` |
| `outbox_events` | Transactional outbox | see [outbox-pattern](../architecture/outbox-pattern.md) |

Constraints worth knowing: `ledger_balance >= 0`, `reserved_amount >= 0`, an account can be closed only
when the balance is 0 (enforced in code).

## transactions_db (transaction-service)

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `transactions` | One row per deposit/withdrawal/transfer | `id`, `reference` (UNIQUE, `TXN` + yyyyMMdd + 8 chars), `transaction_type`, `status` (PENDING/UNDER_REVIEW/PROCESSING/COMPLETED/FAILED), `source_account_id` (null for DEPOSIT), `destination_account_id` (null for WITHDRAWAL), `amount`, `currency`, `description`, `initiated_by`, `idempotency_key`, `failure_reason`, `failure_code`, `risk_score`, `created_at`, `updated_at`, `completed_at`, `version` |
| `transaction_status_history` | Every status transition | `id`, `transaction_id` (FK), `from_status`, `to_status`, `reason`, `changed_at` |
| `transaction_audit` | Saga actions log (who/what/why per step) | `id`, `transaction_id`, `action`, `actor`, `details`, `created_at` |
| `saga_states` | Saga orchestration state (1:1 with transaction) | `id` (sagaId), `transaction_id` (UNIQUE FK), `status` (AWAITING_FRAUD_CHECK/AWAITING_REVIEW/AWAITING_BALANCE_UPDATE/COMPLETED/FAILED), `current_step`, `retry_count`, `failure_reason`, `started_at`, `updated_at`, `completed_at`, `version` |
| `outbox_events` | Transactional outbox | same layout as accounts_db |
| `processed_events` | Consumer idempotency | `event_id` (PK), `event_type`, `processed_at` |

Idempotency for the API: UNIQUE `(initiated_by, idempotency_key)` (partial index where the key is not
null) — the same `Idempotency-Key` from the same user returns the existing transaction.

## fraud_db (fraud-service)

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `fraud_decisions` | One decision per checked transaction; UNIQUE `transaction_id` makes event handling idempotent | `id`, `transaction_id` (UNIQUE), `account_id`, `transaction_type`, `amount`, `currency`, `initiated_by`, `client_country`, `risk_score` (0-100), `risk_level`, `decision`, `triggered_rules`, `reason`, `correlation_id`, `reviewed_by`, `evaluated_at` |
| `fraud_alerts` | Alerts for REVIEW/BLOCK decisions | `id`, `transaction_id` (UNIQUE), `account_id`, `amount`, `currency`, `risk_score`, `risk_level`, `triggered_rules`, `status` (OPEN/APPROVED/REJECTED), `reason`, `reviewed_by`, `review_notes`, `created_at`, `reviewed_at`, `version` |

`fraud_decisions` is also the history used by VelocityRule (count per account in the last 10 min) and
PatternAnomalyRule (average of the last 20 amounts per account).

## notifications_db (notification-service)

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `notifications` | One row per message to send | `id`, `recipient_id`, `channel` (EMAIL/SMS/PUSH), `type`, `status` (PENDING/SENT/FAILED), `recipient_address`, `subject`, `message`, `html_body`, `reference_id`, `event_id`, `attempts`, `error_message`, `created_at`, `updated_at`, `last_attempt_at`, `sent_at`, `read_at` |
| `account_contacts` | Local copy of contact details from `ACCOUNT_CREATED` (and status changes), one row per account | `account_id` (PK), `account_number`, `customer_id` (indexed), `customer_name`, `email`, `phone`, `created_at`, `updated_at` |
| `processed_events` | Consumer idempotency | `event_id` (PK), `event_type`, `processed_at` |

Email/phone are stored in clear because they are needed for delivery; the API returns them masked.

## audit_db (audit-service)

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `audit_logs` | Append-only log of every event | `id`, `event_id` (UNIQUE — consumer idempotency), `event_type`, `raw_event_type`, `aggregate_id`, `aggregate_type`, `actor`, `action`, `severity` (INFO/WARNING/CRITICAL), `source_service`, `correlation_id`, `details` (masked JSON), `occurred_at`, `recorded_at` |

Triggers `trg_audit_logs_no_update_delete` and `trg_audit_logs_no_truncate` reject `UPDATE`,
`DELETE` and `TRUNCATE` — audit rows can never be changed.

---

## Entity relationships (within a database)

```
accounts_db:      accounts 1──1 account_balances
                  accounts 1──* account_status_history

transactions_db:  transactions 1──1 saga_states
                  transactions 1──* transaction_status_history

fraud_db:         fraud_decisions 1──0..1 fraud_alerts   (joined by transaction_id)
```

Across databases, ids are linked only logically (e.g. `transactions.source_account_id` holds an
`accounts.id` value) and kept consistent through events.

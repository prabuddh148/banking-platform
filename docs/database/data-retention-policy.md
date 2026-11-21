# Data Retention Policy

> This is a learning/demo project. The periods below show **how** a bank would think about retention;
> the exact legal periods depend on the jurisdiction (in India, for example, RBI and the PMLA rules
> require keeping transaction records for at least 5 years after the relationship ends, and the
> DPDP Act 2023 requires deleting personal data when it is no longer needed). Always confirm with the
> compliance team.

## 1. Principles

- **Keep financial records** long enough to meet legal and audit requirements.
- **Delete technical data** (outbox rows, processed-event markers) as soon as it no longer has a purpose.
- **Minimise personal data**: mask it where possible, delete or anonymise it when retention ends.
- **Audit logs are immutable** and are archived, not edited.

## 2. Retention periods

| Database | Data | Retention (active) | After that |
|----------|------|--------------------|------------|
| accounts_db | `accounts`, `account_balances` | While the account is open + 8 years after closure | Anonymise customer PII (name, email, phone), keep financial fields |
| accounts_db | `account_status_history` | Same as account | Same as account |
| accounts_db | balance ledger rows | 8 years | Archive to cold storage |
| transactions_db | `transactions`, `transaction_status_history` | 8 years | Archive to cold storage |
| transactions_db | `saga_states` | 1 year after completion | Delete (transaction row keeps the final status) |
| fraud_db | `fraud_decisions`, `fraud_alerts` | 8 years | Archive |
| notifications_db | `notifications` | 1 year | Delete |
| notifications_db | `account_contacts` | While any account is active | Delete when the customer has no active account |
| audit_db | `audit_logs` | 10 years (2 years online) | Partition/archive older data to cold storage |
| all with outbox | `outbox_events` with status `PUBLISHED` | 7 days | Delete |
| all with outbox | `outbox_events` with status `FAILED` | Until resolved by an operator | Delete after resolution + 30 days |
| all consumers | `processed_events` | 30 days (well beyond Kafka retention) | Delete |
| Kafka | domain topics | 7 days (notification topic 3 days) | Automatic (`retention.ms`) |
| Kafka | `.DLT` topics | 30 days | Automatic; reprocess or record before expiry |
| Logs | application logs | 30 days | Delete |

Why `processed_events` can be deleted: it only protects against duplicate delivery. Once a message
can no longer be re-delivered (it is older than Kafka retention and the outbox has published it), the
marker is no longer needed.

## 3. Cleanup jobs (recommended)

Run daily during low traffic. Example SQL:

```sql
-- accounts_db / transactions_db
DELETE FROM outbox_events
WHERE status = 'PUBLISHED' AND published_at < now() - interval '7 days';

-- every consumer database
DELETE FROM processed_events WHERE processed_at < now() - interval '30 days';

-- transactions_db
DELETE FROM saga_states
WHERE status IN ('COMPLETED', 'FAILED') AND completed_at < now() - interval '1 year';

-- notifications_db
DELETE FROM notifications WHERE created_at < now() - interval '1 year';
```

Delete in batches (e.g. `... AND id IN (SELECT id ... LIMIT 10000)`) to avoid long locks.

## 4. Audit logs

`audit_logs` cannot be updated or deleted (DB triggers). For long-term growth:

1. Convert to **monthly range partitions** on `occurred_at` (a future migration).
2. Detach partitions older than 2 years and export them (e.g. `pg_dump` / `COPY ... TO`) to
   write-once storage.
3. Dropping a detached, archived partition is a compliance-approved operation, logged in the
   change record.

## 5. Right to erasure

A customer erasure request cannot delete financial records that the law requires us to keep. Instead:

1. Close accounts (balance must be 0).
2. Anonymise PII in `accounts` and delete `account_contacts` and old `notifications`.
3. Audit logs already store masked PII (`MaskingUtil`), so they stay as they are.
4. Record the request and actions in the audit log.

## 6. Backups

- Daily full backup + continuous WAL archiving, kept 35 days.
- Backups follow the same retention: data deleted from the live DB disappears from backups when they expire.
- See [database-failover](../runbooks/database-failover.md) for restore steps.

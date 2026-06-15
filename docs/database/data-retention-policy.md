# Data Retention Policy

## Table of Contents

- [Regulatory Context](#regulatory-context)
- [Retention Schedule by Table](#retention-schedule-by-table)
- [Archival Strategy](#archival-strategy)
- [Purge Job Implementation](#purge-job-implementation)
- [GDPR and Right to Erasure](#gdpr-and-right-to-erasure)
- [Backup Retention](#backup-retention)
- [Testing Retention Jobs](#testing-retention-jobs)
- [Policy Review and Audit](#policy-review-and-audit)

---

## Regulatory Context

Financial services data retention is governed by overlapping requirements across multiple jurisdictions. The retention periods in this policy represent the most conservative (longest) requirement across all jurisdictions where the platform currently operates.

| Regulation / Jurisdiction              | Data Category                            | Minimum Retention |
|----------------------------------------|------------------------------------------|-------------------|
| US Bank Secrecy Act (BSA)              | Transaction records, SAR-related data    | 5 years           |
| US Dodd-Frank Act                      | Swap transaction and trading records     | 5 years           |
| EU GDPR (Article 17 + Recital 65)      | Personal data                            | Minimum necessary; financial records exempt under Article 17(3)(b) |
| EU 6th Anti-Money Laundering Directive | CDD records, transaction data            | 5 years after end of relationship |
| UK FCA SYSC 9.1                        | Electronic communications, records       | 5–7 years         |
| PCI DSS Requirement 10                 | Access logs and audit trails             | 1 year; 3 months immediately accessible |
| Platform policy (conservative)         | All financial data                       | 7 years           |

**Platform policy**: Retain all financial records (transactions, account history, audit logs, fraud alerts) for 7 years from the date of the event. This satisfies all currently-served jurisdictions and provides buffer for regulatory changes.

**Legal holds**: Legal holds override all retention schedules. When a legal hold is placed on a customer or account, all records linked to that entity are excluded from purge jobs until the hold is formally lifted by the Legal team. Legal holds are tracked in a dedicated `legal_holds` table in `account_db` and referenced by all purge jobs before any row is deleted.

---

## Retention Schedule by Table

### Summary

| Table                      | Schema        | Service              | Retention Period                         | Deletion Method        | Archive Before Delete |
|----------------------------|---------------|----------------------|------------------------------------------|------------------------|-----------------------|
| accounts                   | accounts      | account-service      | Indefinite (anonymized after closure+7yr)| Anonymization only     | N/A                   |
| account_balance            | accounts      | account-service      | Indefinite                               | Never deleted          | N/A                   |
| account_status_history     | accounts      | account-service      | 7 years from changed_at                  | Purge job (weekly)     | Yes                   |
| transactions               | transactions  | transaction-service  | 7 years from initiated_at                | Purge job (weekly)     | Yes                   |
| transaction_audit          | transactions  | transaction-service  | 7 years from recorded_at                 | Purge job (weekly)     | Yes                   |
| transaction_status_history | transactions  | transaction-service  | 3 years from transitioned_at             | Purge job (weekly)     | No                    |
| saga_state                 | transactions  | transaction-service  | 90 days from updated_at (terminal only)  | Purge job (daily)      | No                    |
| outbox_events (PUBLISHED)  | accounts/txn  | account/txn service  | 7 days from published_at                 | Purge job (daily)      | No                    |
| outbox_events (FAILED)     | accounts/txn  | account/txn service  | 30 days from created_at                  | Purge job (daily)      | No                    |
| fraud_alerts               | fraud         | fraud-service        | 7 years from created_at                  | Purge job (weekly)     | Yes                   |
| notifications              | notifications | notification-service | 1 year from created_at                   | Purge job (weekly)     | No                    |
| audit_logs                 | audit         | audit-service        | 7 years from occurred_at                 | Purge job (weekly)     | Yes                   |

---

### Per-Table Retention Details

#### `accounts` — Indefinite

Account rows are never deleted. Once CLOSED, the `status` column is set to `CLOSED` and the account cannot be reopened. The account record is retained indefinitely for ledger integrity and regulatory traceability. After 7 years from the account closure date (tracked via `account_status_history`), PII-adjacent fields are anonymized (see [GDPR and Right to Erasure](#gdpr-and-right-to-erasure)). The row itself remains.

#### `account_balance` — Indefinite

Balance records represent the financial ledger. They are retained as long as the account exists and are never deleted. These records are critical for regulatory examinations, balance reconciliation, and dispute resolution regardless of account age.

#### `account_status_history` — 7 Years from `changed_at`

Status transition records are compliance-relevant: they document when an account was frozen, who authorized it, and why. Retain for 7 years. After archival to `accounts.account_status_history_archive`, the row is purged from the live table. Records under a legal hold are never purged.

#### `transactions` — 7 Years from `initiated_at`

Transaction records are the primary financial record and the most critical retention target. Retain for 7 years from the initiation date. All terminal statuses (COMPLETED, FAILED, REVERSED) are eligible after the retention window. Archive to `transactions.transactions_archive` before deletion. PENDING or IN_PROGRESS transactions are never purged regardless of age (they indicate unresolved state that must be investigated).

#### `transaction_audit` — 7 Years from `recorded_at`

Immutable audit trail entries are retained co-terminously with their parent transaction. The purge job for `transaction_audit` uses the same 7-year cutoff as `transactions`. Rows in this table are never updated; they are only ever inserted and eventually purged.

#### `transaction_status_history` — 3 Years from `transitioned_at`

State machine transition history is operationally useful for debugging and internal audit but is less critical for external regulatory compliance than the primary transaction record. 3 years is sufficient for operational investigation purposes. Not archived before deletion; purged directly.

#### `saga_state` — 90 Days from `updated_at` (terminal statuses only)

Saga state is operational data, not a compliance record. Completed or failed sagas are retained for 90 days to support:

- Post-incident debugging of failed distributed transactions.
- Idempotency checks (detecting re-submitted transaction requests).

Sagas in non-terminal statuses (`STARTED`, `IN_PROGRESS`, `COMPENSATING`) are never purged by the scheduled job. Only `COMPLETED` and `FAILED` sagas are eligible for purge after 90 days.

#### `outbox_events` (PUBLISHED) — 7 Days / (FAILED) — 30 Days

PUBLISHED outbox events have served their purpose once the Kafka acknowledgement is confirmed (`published_at IS NOT NULL`). They are retained for 7 days as a safety net: if a downstream consumer reports a missing message, the event can be replayed from the outbox within that window. After 7 days, Kafka's own topic retention (7 days by default on transaction topics) becomes the replay mechanism.

FAILED outbox events are retained for 30 days to allow investigation and manual replay. An alert fires when `retry_count > 5`. The 30-day window gives engineering time to diagnose the root cause and either manually re-queue the event or accept data loss with documented justification.

#### `fraud_alerts` — 7 Years from `created_at`

Fraud records are regulatory records under AML and BSA requirements. Every fraud decision — including ALLOW decisions for non-flagged transactions — must be retained for 7 years. Archive to `fraud.fraud_alerts_archive` before deletion.

#### `notifications` — 1 Year from `created_at`

Notification records are operational, not regulatory. One year provides sufficient history for:

- Customer support queries ("I never received my transaction confirmation").
- Channel performance analysis (delivery rates, bounce rates by provider).
- Retry pattern analysis.

Purged directly without archival. SENT notifications beyond 1 year have no operational value.

#### `audit_logs` — 7 Years from `occurred_at`

The audit log is the platform's primary compliance record and the most important table for regulatory examinations. All events are retained for 7 years. Archive to `audit.audit_logs_archive` before deletion. The archive table lives in a separate tablespace on slower, lower-cost storage (e.g. AWS RDS provisioned IOPS for live, S3-backed Aurora for archive).

---

## Archival Strategy

Before any row is deleted from a live table that requires archival, it is first copied to an archive table in the same database. This guarantees:

1. Zero data loss: the archive INSERT commits before the live table DELETE executes (single transaction).
2. Cold query capability: compliance queries can still run against archive tables, though they use minimal indexes and may be slower.
3. Recovery: if a purge job contains a bug, data can be restored from the archive table without requiring a full database restore from backup.

### Archive Table Convention

Archive tables mirror the live table structure with additional metadata columns:

```sql
-- Example: transactions archive table (created via Flyway migration)
CREATE TABLE transactions.transactions_archive (
    LIKE transactions.transactions INCLUDING ALL
);

ALTER TABLE transactions.transactions_archive
    ADD COLUMN archived_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN archive_reason VARCHAR(100) NOT NULL DEFAULT 'RETENTION_POLICY';

-- Remove the unique constraint on reference_number in archive
-- (archival is idempotent; a row may theoretically be archived multiple times in edge cases)
ALTER TABLE transactions.transactions_archive
    DROP CONSTRAINT IF EXISTS uq_transactions_reference_number;
```

Archive table indexes are minimal — only the indexes needed for compliance queries:

```sql
-- Archive tables: minimal index set for compliance query support
CREATE INDEX ON transactions.transactions_archive(initiated_at DESC);
CREATE INDEX ON transactions.transactions_archive(source_account_id);
CREATE INDEX ON transactions.transactions_archive(target_account_id);
CREATE INDEX ON transactions.transactions_archive(archived_at DESC);
```

### Archive-then-Delete Transaction

The purge service executes archive and delete within a single database transaction:

```java
@Transactional
public int archiveAndPurgeTransactions(Instant cutoff) {
    // Step 1: Copy eligible rows to the archive table
    int archived = jdbcTemplate.update("""
        INSERT INTO transactions.transactions_archive
        SELECT t.*, now(), 'RETENTION_POLICY'
        FROM transactions.transactions t
        WHERE t.initiated_at < ?
          AND t.status IN ('COMPLETED', 'FAILED', 'REVERSED')
          AND t.id NOT IN (
              SELECT resource_id
              FROM accounts.legal_holds
              WHERE active = true
                AND resource_type = 'Transaction'
          )
        ON CONFLICT (id) DO NOTHING
        """, cutoff);

    // Step 2: Delete the archived rows from the live table
    int deleted = jdbcTemplate.update("""
        DELETE FROM transactions.transactions t
        WHERE t.initiated_at < ?
          AND t.status IN ('COMPLETED', 'FAILED', 'REVERSED')
          AND EXISTS (
              SELECT 1 FROM transactions.transactions_archive a
              WHERE a.id = t.id
          )
        """, cutoff);

    // Invariant check: every deleted row must have been archived
    if (archived != deleted) {
        throw new RetentionPolicyException(
            "Archive/delete count mismatch: archived=" + archived +
            ", deleted=" + deleted + ". Rolling back entire transaction.");
    }

    return deleted;
}
```

---

## Purge Job Implementation

### Scheduling

Each service runs its own purge job via Spring `@Scheduled`. Jobs are spread across different days and times to avoid concurrent database load.

| Service              | Purge Day  | Schedule Cron             | Tables Purged                                                   |
|----------------------|------------|---------------------------|-----------------------------------------------------------------|
| account-service      | Sunday     | `0 0 2 * * SUN`           | account_status_history, outbox_events                           |
| transaction-service  | Monday     | `0 0 2 * * MON`           | transactions, transaction_audit, transaction_status_history     |
| transaction-service  | Daily      | `0 0 3 * * *`             | saga_state, outbox_events                                       |
| fraud-service        | Tuesday    | `0 0 2 * * TUE`           | fraud_alerts                                                    |
| notification-service | Wednesday  | `0 0 2 * * WED`           | notifications                                                   |
| audit-service        | Thursday   | `0 0 2 * * THU`           | audit_logs                                                      |

### Java Implementation Example

```java
@Component
@Slf4j
public class TransactionRetentionService {

    private static final Duration TRANSACTION_RETENTION = Duration.ofDays(7 * 365);
    private static final Duration SAGA_RETENTION = Duration.ofDays(90);
    private static final Duration OUTBOX_PUBLISHED_RETENTION = Duration.ofDays(7);
    private static final Duration OUTBOX_FAILED_RETENTION = Duration.ofDays(30);

    @Scheduled(cron = "0 0 3 * * *", zone = "UTC")
    public void purgeCompletedSagas() {
        Instant cutoff = Instant.now().minus(SAGA_RETENTION);
        int purged = sagaStateRepository.deleteByStatusInAndUpdatedAtBefore(
            List.of(SagaStatus.COMPLETED, SagaStatus.FAILED), cutoff);
        log.info("Saga purge: {} records deleted (cutoff={})", purged, cutoff);
        meterRegistry.counter("retention.purge.records",
            "table", "saga_state", "service", "transaction-service").increment(purged);
    }

    @Scheduled(cron = "0 30 3 * * *", zone = "UTC")
    public void purgePublishedOutboxEvents() {
        Instant publishedCutoff = Instant.now().minus(OUTBOX_PUBLISHED_RETENTION);
        Instant failedCutoff = Instant.now().minus(OUTBOX_FAILED_RETENTION);

        int publishedPurged = outboxEventRepository
            .deleteByStatusAndPublishedAtBefore(OutboxStatus.PUBLISHED, publishedCutoff);
        int failedPurged = outboxEventRepository
            .deleteByStatusAndCreatedAtBefore(OutboxStatus.FAILED, failedCutoff);

        log.info("Outbox purge: {} PUBLISHED, {} FAILED records deleted",
            publishedPurged, failedPurged);
    }

    @Scheduled(cron = "0 0 2 * * MON", zone = "UTC")
    public void purgeAgedTransactions() {
        Instant cutoff = Instant.now().minus(TRANSACTION_RETENTION);
        int deleted = transactionPurgeRepository.archiveAndPurge(cutoff);
        log.info("Transaction retention purge: {} rows archived and deleted", deleted);
        emitAuditEvent("DATA_RETENTION_PURGE", "transactions", deleted);
    }
}
```

### Batch Processing to Avoid Lock Contention

Long-running DELETE statements hold row locks that block concurrent reads and writes. Purge jobs process records in batches with brief pauses between batches:

```java
public int purgeBatched(Instant cutoff, int batchSize) {
    int totalPurged = 0;
    int purgedInBatch;

    do {
        purgedInBatch = jdbcTemplate.update("""
            DELETE FROM notifications.notifications
            WHERE id IN (
                SELECT id FROM notifications.notifications
                WHERE created_at < ?
                  AND status IN ('SENT', 'CANCELLED')
                ORDER BY created_at ASC
                LIMIT ?
            )
            """, cutoff, batchSize);
        totalPurged += purgedInBatch;

        if (purgedInBatch > 0) {
            try {
                Thread.sleep(100); // 100ms pause between batches; reduces lock pressure
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                log.warn("Purge job interrupted after {} records deleted", totalPurged);
                break;
            }
        }
    } while (purgedInBatch == batchSize);

    return totalPurged;
}
```

### Purge Job Monitoring

All purge runs emit metrics and audit events:

```java
private void emitAuditEvent(String eventType, String resourceType, int recordCount) {
    auditEventPublisher.publish(AuditEvent.builder()
        .eventType(eventType)
        .severity(Severity.INFO)
        .actorType(ActorType.SYSTEM)
        .actorId(SYSTEM_ACTOR_ID)
        .resourceType(resourceType)
        .action("DELETE")
        .description("Retention purge completed: " + recordCount + " records removed")
        .sourceService(serviceName)
        .occurredAt(Instant.now())
        .build());
}
```

**Alerting thresholds**:

- Purge job throws any exception: PagerDuty P3.
- Purge job deletes zero rows for 4 consecutive weekly runs: possible scheduler failure — P4 alert.
- Purge job deletes more than 10x the 4-week rolling average in a single run: anomalous volume — P3 alert for review before production data loss escalates.

---

## GDPR and Right to Erasure

GDPR Article 17 grants individuals the right to erasure. However, Article 17(3)(b) explicitly exempts data whose processing is necessary for compliance with a legal obligation, including financial record-keeping laws. For this platform:

**Cannot be erased** (legal retention obligation overrides GDPR erasure):

- Transaction amounts, dates, reference numbers, account IDs, and status history.
- Fraud alert risk scores, decisions, triggered rules, and review outcomes.
- Audit log entries describing financial actions.

**Must be anonymized on a valid GDPR erasure request**:

- `accounts.accounts` — `customer_id` is a UUID reference; no customer name or email is stored in this table. Erasure of PII (name, email, address) is handled by customer-service. The `customer_id` UUID in this table is replaced with a deterministic, irreversible hash.
- `notifications.notifications` — `recipient_id` is anonymized; `payload` JSONB (which may contain the customer's name in rendered email content) is replaced with `{"anonymized": true, "reason": "GDPR_ERASURE"}`.
- `audit_logs.metadata` — may contain IP address, user agent, and session ID. The `metadata` field is replaced with `{"anonymized": true}` for events originating from the subject customer.

### Anonymization Implementation

```java
@Service
@Transactional
public class CustomerDataErasureService {

    @Value("${gdpr.erasure.salt}")
    private String erasureSalt;

    public ErasureResult anonymizeCustomerData(UUID customerId, String requestReference) {
        String anonymizedId = deterministicAnonymize(customerId);
        int accountsUpdated = 0;

        // Replace customer_id with a deterministic hash in accounts
        accountsUpdated += jdbcTemplate.update("""
            UPDATE accounts.accounts
            SET customer_id = ?::uuid,
                updated_at = now()
            WHERE customer_id = ?
            """, anonymizedId, customerId);

        // Anonymize notification recipient_id and payload
        int notificationsUpdated = jdbcTemplate.update("""
            UPDATE notifications.notifications
            SET recipient_id = ?::uuid,
                payload = '{"anonymized": true, "reason": "GDPR_ERASURE"}'::jsonb
            WHERE recipient_id = ?
            """, anonymizedId, customerId);

        // Record the erasure in audit log (using anonymized ID; never log original)
        auditEventPublisher.publish(AuditEvent.builder()
            .eventType("GDPR_ERASURE")
            .severity(Severity.WARNING)
            .actorType(ActorType.SYSTEM)
            .resourceType("Customer")
            .resourceId(UUID.fromString(anonymizedId))
            .action("ANONYMIZE")
            .description("GDPR erasure request " + requestReference + " processed")
            .sourceService("account-service")
            .occurredAt(Instant.now())
            .build());

        return new ErasureResult(accountsUpdated, notificationsUpdated, requestReference);
    }

    private String deterministicAnonymize(UUID id) {
        // Deterministic: same input always produces same output (enables cross-service consistency)
        // Irreversible: cannot derive the original UUID from the output without the salt
        return UUID.nameUUIDFromBytes(
            (id.toString() + erasureSalt).getBytes(StandardCharsets.UTF_8)
        ).toString();
    }
}
```

### Erasure Request Timeline

| Step | Timeline     | Action                                                          |
|------|--------------|-----------------------------------------------------------------|
| 1    | Day 0        | Erasure request received via customer portal or support ticket  |
| 2    | Day 0–1      | Identity verification; legal hold check; jurisdiction check     |
| 3    | Day 1–3      | If valid and no legal hold: anonymization jobs run across all services |
| 4    | Day 3        | Confirmation sent to customer; supervisory authority notified if required by jurisdiction |
| 5    | Day 30       | Internal verification: confirm no residual unanonymized PII in daily backups (pre-erasure backups expire by day 30) |

---

## Backup Retention

Backups are managed at the infrastructure level (AWS RDS automated snapshots or pg_basebackup to S3). Application code does not manage backup scheduling or storage.

| Backup Type           | Frequency       | Retention Period | Storage Class            | Notes                                           |
|-----------------------|-----------------|------------------|--------------------------|-------------------------------------------------|
| Automated snapshot    | Daily at 01:00 UTC | 30 days       | S3 Standard              | Enables point-in-time recovery within window    |
| Monthly snapshot      | 1st of month at 00:00 UTC | 1 year | S3 Standard-IA          | Taken from the daily snapshot of the 1st        |
| Annual snapshot       | Jan 1 at 00:00 UTC | 7 years       | S3 Glacier Deep Archive  | Compliance archive; retrieval takes hours       |
| Pre-migration snapshot| Before each production migration | 30 days | S3 Standard       | Automatic; named `pre-migration-{service}-{date}` |
| GDPR erasure baseline | Before each erasure run | 35 days | S3 Standard       | Retained until all pre-erasure backups expire   |

**Encryption**: All snapshots are AES-256 encrypted using AWS KMS. KMS keys are rotated annually. Key access is restricted to the DBA role and the automated backup system service account.

**Cross-region replication**: Daily snapshots are replicated asynchronously to a secondary AWS region (us-west-2 from us-east-1) within 4 hours of creation. This satisfies the disaster recovery Recovery Time Objective (RTO) of 4 hours.

**Restoration testing**: Snapshots are restored to a dedicated `restore-test` environment on a quarterly schedule. The restored environment is validated by running the full integration test suite against it. Results and any anomalies are documented in the incident management system.

---

## Testing Retention Jobs

### Pre-Production Validation Checklist

Before deploying any new purge job or modifying retention parameters, complete this checklist in the staging environment:

- [ ] Seed staging with synthetic data spanning the retention boundary: records just inside (should survive) and just outside (should be purged) the retention window.
- [ ] Add at least one record under a legal hold that falls outside the retention window — confirm it is NOT purged.
- [ ] Run the purge job manually: `java -jar service.jar --retention.dry-run=true` and review the log output showing which records would be affected.
- [ ] Run again without dry-run: `java -jar service.jar` and confirm the job runs on schedule.
- [ ] Verify records outside the retention window were archived (where applicable) and deleted from the live table.
- [ ] Verify records inside the retention window were untouched.
- [ ] Verify legal-held records were untouched even though they are outside the retention window.
- [ ] Verify the archive table received the correct rows with the correct `archived_at` timestamp.
- [ ] Run `EXPLAIN` on the purge DELETE query to confirm index usage — no sequential scans on large tables.
- [ ] Verify the audit event for the purge run appears in audit-service with the correct record count.
- [ ] Confirm table sizes before and after reflect the expected reduction.

### Integration Test Coverage

```java
@SpringBootTest
@Testcontainers
class TransactionRetentionServiceIntegrationTest {

    @Test
    void shouldArchiveAndPurgeTrasactionsOlderThanSevenYears() {
        // 7.1 years old: eligible for purge
        UUID oldTxnId = insertTransaction(Instant.now().minus(2600, ChronoUnit.DAYS));
        // 5.7 years old: within retention window
        UUID recentTxnId = insertTransaction(Instant.now().minus(2100, ChronoUnit.DAYS));

        retentionService.purgeAgedTransactions();

        assertThat(transactionRepository.findById(oldTxnId)).isEmpty();
        assertThat(archiveRepository.findByOriginalId(oldTxnId)).isPresent();
        assertThat(transactionRepository.findById(recentTxnId)).isPresent();
        assertThat(archiveRepository.findByOriginalId(recentTxnId)).isEmpty();
    }

    @Test
    void shouldNotPurgeTransactionUnderActiveLegalHold() {
        UUID heldTxnId = insertTransaction(Instant.now().minus(3000, ChronoUnit.DAYS));
        legalHoldRepository.save(LegalHold.of(heldTxnId, "Transaction", true));

        retentionService.purgeAgedTransactions();

        assertThat(transactionRepository.findById(heldTxnId)).isPresent();
        assertThat(archiveRepository.findByOriginalId(heldTxnId)).isEmpty();
    }

    @Test
    void shouldOnlyPurgeTerminalSagasOlderThan90Days() {
        UUID completedOldSagaId = insertSaga(SagaStatus.COMPLETED,
            Instant.now().minus(95, ChronoUnit.DAYS));
        UUID inProgressSagaId = insertSaga(SagaStatus.IN_PROGRESS,
            Instant.now().minus(95, ChronoUnit.DAYS));

        retentionService.purgeCompletedSagas();

        assertThat(sagaRepository.findById(completedOldSagaId)).isEmpty();
        assertThat(sagaRepository.findById(inProgressSagaId)).isPresent(); // protected
    }
}
```

### Dry-Run Mode

All purge jobs support a dry-run mode that logs what would be deleted without committing:

```java
@Value("${retention.dry-run:false}")
private boolean dryRun;

@Transactional
public int purge(Instant cutoff) {
    int count = countEligibleRows(cutoff);
    log.info("[retention] {} rows eligible for deletion (cutoff={})", count, cutoff);

    if (dryRun) {
        log.info("[retention] DRY RUN mode active — no rows deleted");
        TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
        return 0;
    }

    return executeArchiveAndDelete(cutoff);
}
```

Enable dry-run via environment variable before any production purge: `RETENTION_DRY_RUN=true`.

---

## Policy Review and Audit

This retention policy requires formal review:

- **Annually**: Engineering, Legal, and Compliance must confirm alignment with current regulatory requirements.
- **When entering a new jurisdiction**: Before launch in any new country, the retention schedule must be updated to reflect local laws. Engineering must not expand to new jurisdictions without a Legal sign-off on the updated policy.
- **When regulations change**: The Legal team is responsible for notifying Engineering within 30 days of any relevant regulatory change.

All changes to retention periods must go through the standard pull request review process with mandatory written approval from both the Engineering Lead and the Compliance team. Unilateral changes to retention periods by Engineering alone are not permitted.

**Document owner**: Platform Engineering (devtools@theforgelabs.io)
**Legal reviewer**: Compliance and Legal team
**Last reviewed**: 2026-06-15
**Next scheduled review**: 2027-06-15

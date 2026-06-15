# Database Migration Strategy

## Table of Contents

- [Why Flyway](#why-flyway)
- [Migration Naming Convention](#migration-naming-convention)
- [Directory Structure](#directory-structure)
- [Flyway Configuration](#flyway-configuration)
- [Migration Rules](#migration-rules)
- [Rollback Strategy](#rollback-strategy)
- [Testing Migrations](#testing-migrations)
- [Multi-Module Setup](#multi-module-setup)
- [CI/CD Integration](#cicd-integration)
- [Emergency Procedures](#emergency-procedures)
- [Migration History Reference](#migration-history-reference)

---

## Why Flyway

Flyway was selected over Liquibase and manual scripts for the following reasons:

| Criterion              | Flyway                                               | Alternative (Liquibase)                              |
|------------------------|------------------------------------------------------|------------------------------------------------------|
| Format                 | Plain SQL; every DBA can read and review migrations  | XML/YAML/JSON changelogs; requires Liquibase DSL knowledge |
| Spring Boot integration| `spring.flyway.*` auto-configuration, zero boilerplate | Requires additional Spring Liquibase bean wiring   |
| Version control        | Filename encodes version; Git history is the audit trail | changeset IDs; easier to make mistakes in merge conflicts |
| Team adoption          | Low learning curve; write SQL, commit, deploy        | Steeper ramp-up for teams unfamiliar with Liquibase DSL |
| Diff detection         | Checksum per migration file; tampering detected immediately | Similar checksum mechanism                      |
| OSS license            | Apache 2.0; all features used here are in the free tier | Free tier has limitations on rollback support    |

**Key capabilities used**:

- `flyway.validate-on-migrate=true` — refuses to start if any applied migration's checksum has changed.
- `flyway.out-of-order=false` — strictly enforces sequential version order in production.
- `flyway.schemas` — confines Flyway to the service's own schema; cannot accidentally touch another service's schema.
- `flyway.baseline-on-migrate=true` — used only when migrating a pre-existing database to Flyway management.

---

## Migration Naming Convention

```
V{version}__{description}.sql
```

Rules:

- `V` is uppercase.
- `{version}` is an integer (1, 2, 3…). Decimals are permitted (e.g. `V1.1`) but discouraged; prefer whole numbers.
- `__` is two underscores (not one).
- `{description}` uses underscores, not spaces or hyphens. Keep it concise but meaningful.
- Use lowercase only in the description to avoid case-sensitivity issues on case-sensitive filesystems.

**Valid examples**:

```
V1__create_accounts_schema.sql
V2__add_account_limits.sql
V3__create_account_status_history.sql
V4__add_account_balance_table.sql
V5__create_outbox_events.sql
V6__add_account_number_format_constraint.sql
V7__backfill_missing_currencies.sql
```

**Repeatable migrations** (prefix `R__`) are used only for views and functions that Flyway re-applies when their content changes. They are not used for tables.

```
R__v_active_accounts_view.sql
```

**Do not use**:

- `V01__`, `V001__` — leading zeros. Flyway treats version as a number, but zero-padded filenames cause confusion.
- `V1.0__` — decimal notation for initial migrations; reserve decimals for hotfix insertions between released versions.
- Spaces or special characters in the description.

---

## Directory Structure

Each service module contains its own migration directory. Migrations are never shared across services.

```
banking-platform/
├── account-service/
│   └── src/
│       └── main/
│           └── resources/
│               └── db/
│                   └── migration/
│                       ├── V1__create_accounts_schema.sql
│                       ├── V2__create_account_balance.sql
│                       ├── V3__create_account_status_history.sql
│                       ├── V4__create_outbox_events.sql
│                       └── V5__add_account_indexes.sql
├── transaction-service/
│   └── src/
│       └── main/
│           └── resources/
│               └── db/
│                   └── migration/
│                       ├── V1__create_transactions_schema.sql
│                       ├── V2__create_transaction_audit.sql
│                       ├── V3__create_transaction_status_history.sql
│                       ├── V4__create_saga_state.sql
│                       ├── V5__create_outbox_events.sql
│                       └── V6__add_transaction_indexes.sql
├── fraud-service/
│   └── src/
│       └── main/
│           └── resources/
│               └── db/
│                   └── migration/
│                       ├── V1__create_fraud_schema.sql
│                       └── V2__add_fraud_indexes.sql
├── notification-service/
│   └── src/
│       └── main/
│           └── resources/
│               └── db/
│                   └── migration/
│                       ├── V1__create_notifications_schema.sql
│                       └── V2__add_notification_indexes.sql
└── audit-service/
    └── src/
        └── main/
            └── resources/
                └── db/
                    └── migration/
                        ├── V1__create_audit_schema.sql
                        └── V2__add_audit_indexes.sql
```

Undo/compensating scripts (not applied automatically) are stored separately for reference:

```
banking-platform/
└── docs/
    └── database/
        └── undo-migrations/
            ├── account-service/
            │   └── U5__undo_add_account_indexes.sql
            └── transaction-service/
                └── U6__undo_add_transaction_indexes.sql
```

---

## Flyway Configuration

### account-service `application.yml`

```yaml
spring:
  datasource:
    url: jdbc:postgresql://${DB_HOST:localhost}:5432/account_db
    username: ${DB_USER}
    password: ${DB_PASSWORD}
    hikari:
      schema: accounts
      maximum-pool-size: 20
      minimum-idle: 5
  flyway:
    enabled: true
    schemas: accounts
    locations: classpath:db/migration
    baseline-on-migrate: false          # true only when onboarding a pre-existing DB
    validate-on-migrate: true
    out-of-order: false
    mixed: false                        # disallow mixing versioned and repeatable in one run
    encoding: UTF-8
    connect-retries: 5
    connect-retries-interval: 10s
```

### transaction-service `application.yml`

```yaml
spring:
  datasource:
    url: jdbc:postgresql://${DB_HOST:localhost}:5432/transaction_db
    username: ${DB_USER}
    password: ${DB_PASSWORD}
    hikari:
      schema: transactions
  flyway:
    enabled: true
    schemas: transactions
    locations: classpath:db/migration
    validate-on-migrate: true
    out-of-order: false
```

All other services follow the same pattern, substituting their `DB_HOST`, database name, and schema name. Each service uses a dedicated database user with `CONNECT`, `USAGE`, `CREATE` on its schema and `SELECT`, `INSERT`, `UPDATE`, `DELETE` on its tables. No service user has superuser, `DROP`, or cross-database privileges.

### Disabling Flyway in Unit Tests

```yaml
# src/test/resources/application-unit-test.yml
spring:
  flyway:
    enabled: false
  jpa:
    hibernate:
      ddl-auto: create-drop
```

Integration tests use TestContainers and do NOT disable Flyway. See [Testing Migrations](#testing-migrations).

---

## Migration Rules

These rules are non-negotiable in staging and production. Violations require an incident report.

### Rule 1: Never Modify an Applied Migration

Once a migration has been applied to any shared environment (dev-shared, staging, production), its SQL content must not change. Flyway stores a checksum of each applied migration in `flyway_schema_history`. A checksum mismatch causes the service to refuse startup:

```
Validate failed: Migration checksum mismatch for migration version 3
-> Applied to database : 1234567890
-> Resolved locally    : 9876543210
```

If you need to fix a mistake in a migration that exists only in your local environment, reset your local DB and rewrite the file before pushing. If the migration has reached any shared environment, write a new migration.

### Rule 2: Only Additive Changes in Non-Dev Environments

**Non-breaking changes allowed at any time**:

- Adding a new column (nullable, or with a `DEFAULT`).
- Adding a new index (`CREATE INDEX CONCURRENTLY`).
- Adding a new table.
- Widening a VARCHAR column (e.g. `VARCHAR(50)` to `VARCHAR(100)`).
- Adding a new CHECK constraint value (a new enum value).

**Changes that require a coordinated deployment window**:

- Renaming a column (use a three-step expand/migrate/contract pattern over multiple releases).
- Adding a NOT NULL column without a default (requires a data backfill migration first).
- Dropping a column (only after all application code no longer references it).
- Changing a column type incompatibly (e.g. `VARCHAR` to `INTEGER`).

### Rule 3: Large Data Migrations Are Separate

If a migration backfills data across millions of rows, it must use batched UPDATEs to avoid locking the table for extended periods. Example:

```sql
-- V7__backfill_missing_currencies.sql
DO $$
DECLARE
  batch_size INT := 1000;
  offset_val INT := 0;
  rows_updated INT;
BEGIN
  LOOP
    UPDATE accounts.accounts
    SET currency = 'USD'
    WHERE currency IS NULL
      AND id IN (
        SELECT id FROM accounts.accounts
        WHERE currency IS NULL
        ORDER BY created_at
        LIMIT batch_size OFFSET offset_val
      );
    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    EXIT WHEN rows_updated = 0;
    offset_val := offset_val + batch_size;
    PERFORM pg_sleep(0.05); -- 50ms pause between batches to reduce lock pressure
  END LOOP;
END $$;
```

### Rule 4: Index Creation Uses CONCURRENTLY

All index creation in migration files targeting production must use `CREATE INDEX CONCURRENTLY`. This avoids a full table lock during index build, which would block reads and writes for the duration.

```sql
-- V5__add_account_indexes.sql
-- flyway:disableTransaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_customer_id
    ON accounts.accounts(customer_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_status
    ON accounts.accounts(status);
```

Note: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block. The `-- flyway:disableTransaction` directive tells Flyway not to wrap this migration in a transaction. Use it only for migrations that consist entirely of `CONCURRENTLY` operations.

---

## Rollback Strategy

Flyway OSS does not provide an automatic `undo` command (that is a Flyway Teams feature). The strategy for this platform is forward-only compensation.

### Forward Compensation (Preferred)

Write a new migration that compensates for the unwanted change:

```sql
-- V9__remove_experimental_column.sql
ALTER TABLE accounts.accounts DROP COLUMN IF EXISTS experimental_field;
```

This is the recommended approach in all environments. It preserves a complete, auditable history of every change made to the schema.

### Emergency Database Restore (Last Resort)

If a migration causes a critical production outage and a forward migration cannot be deployed fast enough:

1. Restore the previous database backup snapshot (RDS automated snapshot or pg_basebackup).
2. Roll back the application deployment to the previous container image.
3. The `flyway_schema_history` table in the restored snapshot will not contain the failed migration.
4. Never manually DELETE from `flyway_schema_history` to mask a migration; use restore procedures only.

### Pre-Migration Checklist

Before deploying any migration to staging or production:

- [ ] Migration tested locally with production-volume data if it touches large tables.
- [ ] `EXPLAIN` run on any queries the new indexes are designed to serve.
- [ ] Undo/compensating script written and reviewed, stored in `docs/database/undo-migrations/`.
- [ ] PR reviewed by at least one engineer with DBA or senior backend experience.
- [ ] Migration validated in staging: service started cleanly, Flyway logs show no errors.
- [ ] On-call engineer notified before production deployment if the migration is non-trivial.

---

## Testing Migrations

### Local Development

Flyway runs automatically on application startup. Developer workflow for a clean run:

```bash
# Drop and recreate the local database, then start the service
psql -U postgres -c "DROP DATABASE IF EXISTS account_db;"
psql -U postgres -c "CREATE DATABASE account_db;"
./mvnw spring-boot:run -pl account-service
# Flyway applies all migrations on startup; service logs show each applied version
```

### Integration Tests with TestContainers

Each service's integration test suite spins up a real PostgreSQL 16 instance using TestContainers. Flyway applies all migrations against it before tests run.

```java
@SpringBootTest
@Testcontainers
class AccountRepositoryIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("account_db")
            .withUsername("test_user")
            .withPassword("test_pass");

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        // spring.flyway.enabled defaults to true; migrations apply automatically
    }

    @Test
    void migrationsShouldApplyCleanly() {
        // ApplicationContext startup validates this implicitly.
        // If any migration fails, the context fails to load and this test fails.
        // Explicit assertion: confirm flyway_schema_history row count matches expected.
    }
}
```

The TestContainers PostgreSQL instance is isolated per test class and discarded after the test run.

### Migration Validation in CI Pipeline

```yaml
# .github/workflows/ci.yml (excerpt)
- name: Validate Flyway migrations (account-service)
  run: |
    docker run -d --name pg-validate \
      -e POSTGRES_DB=account_db \
      -e POSTGRES_USER=ci_user \
      -e POSTGRES_PASSWORD=ci_pass \
      -p 5432:5432 postgres:16-alpine
    sleep 3
    ./mvnw flyway:migrate -pl account-service \
      -Dflyway.url=jdbc:postgresql://localhost:5432/account_db \
      -Dflyway.user=ci_user \
      -Dflyway.password=ci_pass \
      -Dflyway.schemas=accounts
    docker stop pg-validate && docker rm pg-validate
```

---

## Multi-Module Setup

The `banking-platform` parent POM does not include Flyway configuration. Each service module declares it independently:

```xml
<!-- account-service/pom.xml -->
<dependencies>
    <dependency>
        <groupId>org.flywaydb</groupId>
        <artifactId>flyway-core</artifactId>
    </dependency>
    <dependency>
        <groupId>org.flywaydb</groupId>
        <artifactId>flyway-database-postgresql</artifactId>
    </dependency>
</dependencies>
```

Flyway version is managed in the parent POM's `dependencyManagement` to keep all services on the same Flyway version:

```xml
<!-- parent/pom.xml -->
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.flywaydb</groupId>
            <artifactId>flyway-core</artifactId>
            <version>10.15.0</version>
        </dependency>
        <dependency>
            <groupId>org.flywaydb</groupId>
            <artifactId>flyway-database-postgresql</artifactId>
            <version>10.15.0</version>
        </dependency>
    </dependencies>
</dependencyManagement>
```

Spring Boot 3.2.5's `spring-boot-starter-data-jpa` does not include `flyway-database-postgresql` automatically. It must be declared explicitly for PostgreSQL 10+ compatibility (Flyway 10.x split the database-specific modules out of `flyway-core`).

---

## CI/CD Integration

Migrations run as part of service startup, not as a separate pipeline step. This keeps schema change and code deployment atomic: if the migration fails, the service does not start, health checks fail, and the deployment platform rolls back to the previous version automatically.

**Deployment sequence in Kubernetes**:

1. New pod starts with the updated container image.
2. `SpringApplication.run()` initializes the Spring context.
3. Flyway acquires the advisory lock on the target database schema (prevents concurrent migration runs from multiple pods of the same service starting simultaneously).
4. Flyway checks `flyway_schema_history` and applies pending migrations in order.
5. Flyway releases the advisory lock.
6. Application context finishes loading (JPA entities validated, Spring beans initialized).
7. Pod passes the readiness probe (`/actuator/health`).
8. Kubernetes routes traffic to the new pod.
9. Old pod is gracefully terminated after its in-flight requests complete.

**Zero-downtime rolling deployment requirement**: Because migrations run on pod startup, every migration must be backward-compatible with the previous version of the application code. Old pods must continue to function against the new schema until they are replaced. This is enforced by the additive-only rule.

If a migration is not backward-compatible (e.g. dropping a column that the old code reads), a two-phase deployment is required:

- Phase 1: Deploy application code that no longer references the column. No schema change yet.
- Phase 2 (next release): Deploy the migration that drops the column.

---

## Emergency Procedures

### Scenario 1: Migration Fails Mid-Run

Flyway wraps most migrations in a transaction. If the SQL fails, the transaction rolls back and `flyway_schema_history` is not updated. The service fails to start. Resolution:

1. Identify the error in service logs (`FlywayException` with SQL state and message).
2. Fix the SQL in the migration file. This is the rare case where editing an unapplied migration is acceptable — it was never committed to `flyway_schema_history`.
3. Redeploy the service with the corrected migration.
4. Do not manually alter the database schema to work around the error.

### Scenario 2: Flyway Detects a Checksum Mismatch

```
Validate failed: Migration checksum mismatch for migration version 4
-> Applied to database : 1234567890
-> Resolved locally    : 9876543210
```

1. Identify what changed using `git diff` on the migration file.
2. If the change is cosmetic (trailing whitespace, comment-only), revert the file to match what was applied.
3. If a functional fix was applied directly to the file after it reached a shared environment: create a compensating migration and run `./mvnw flyway:repair` only if the applied SQL and the current file are functionally equivalent. Document the repair in the incident log.
4. Never delete a row from `flyway_schema_history` to mask the mismatch.

### Scenario 3: Two Developers Write the Same Version Number

Both developers create `V6__<different_description>.sql`. The developer whose PR merges second must renumber their migration to V7 before merging. CI catches the conflict via `flyway:validate` if both files exist in the same branch. To prevent this: assign version numbers by creating a placeholder commit in the migration directory before starting significant work.

### Scenario 4: Migration Succeeds but Application Fails to Start

The schema change was applied but the application code has a startup bug. `flyway_schema_history` now contains the new version as applied. Resolution:

1. Roll back the application deployment to the previous container image.
2. The previous code version must still work with the new schema (additive-only rule ensures this).
3. Fix the application bug and redeploy. Flyway sees the migration as already applied and skips it.
4. If the schema change must also be reverted, write a compensating migration in the next release.

---

## Migration History Reference

Update this table with every migration merged to the main branch. It provides a human-readable history without requiring access to `flyway_schema_history`.

| Version | Description                       | Service              | Applied Date | Breaking Change | Notes                                        |
|---------|-----------------------------------|----------------------|--------------|-----------------|----------------------------------------------|
| V1      | create_accounts_schema            | account-service      | 2024-01-15   | No              | Initial schema; accounts table               |
| V1      | create_transactions_schema        | transaction-service  | 2024-01-15   | No              | Initial schema; transactions table           |
| V1      | create_fraud_schema               | fraud-service        | 2024-01-15   | No              | Initial schema; fraud_alerts table           |
| V1      | create_notifications_schema       | notification-service | 2024-01-15   | No              | Initial schema; notifications table          |
| V1      | create_audit_schema               | audit-service        | 2024-01-15   | No              | Initial schema; audit_logs table             |
| V2      | create_account_balance            | account-service      | 2024-01-20   | No              | Separated balance from accounts row          |
| V2      | create_transaction_audit          | transaction-service  | 2024-01-20   | No              | Immutable audit trail per transaction        |
| V2      | add_fraud_indexes                 | fraud-service        | 2024-01-20   | No              | Performance indexes on fraud_alerts          |
| V2      | add_notification_indexes          | notification-service | 2024-01-20   | No              | Performance indexes on notifications         |
| V2      | add_audit_indexes                 | audit-service        | 2024-01-20   | No              | Performance indexes on audit_logs            |
| V3      | create_account_status_history     | account-service      | 2024-02-01   | No              | Tracks account lifecycle transitions         |
| V3      | create_transaction_status_history | transaction-service  | 2024-02-01   | No              | Tracks transaction state machine transitions |
| V4      | create_outbox_events              | account-service      | 2024-02-10   | No              | Transactional outbox for Kafka publishing    |
| V4      | create_saga_state                 | transaction-service  | 2024-02-10   | No              | Saga orchestration state tracker             |
| V5      | add_account_indexes               | account-service      | 2024-02-15   | No              | Indexes for account query patterns           |
| V5      | create_outbox_events              | transaction-service  | 2024-02-15   | No              | Transactional outbox for transaction events  |
| V6      | add_transaction_indexes           | transaction-service  | 2024-02-20   | No              | Composite index on (status, initiated_at)    |
| V7      | add_metadata_gin_index            | transaction-service  | 2024-03-05   | No              | GIN index on transactions.metadata jsonb     |
| V8      | add_risk_score_constraint         | fraud-service        | 2024-03-10   | No              | CHECK (risk_score BETWEEN 0 AND 100)         |
| V9      | add_correlation_id_index          | audit-service        | 2024-03-15   | No              | Index on audit_logs.correlation_id           |

# Database Schema Overview

## Table of Contents

- [Architecture: Database-per-Service](#architecture-database-per-service)
- [Database Inventory](#database-inventory)
- [Schema Details](#schema-details)
  - [account\_db](#account_db)
  - [transaction\_db](#transaction_db)
  - [fraud\_db](#fraud_db)
  - [notification\_db](#notification_db)
  - [audit\_db](#audit_db)
- [Cross-Service Relationships](#cross-service-relationships)
- [Design Decisions](#design-decisions)

---

## Architecture: Database-per-Service

Each microservice owns its data exclusively. No service reads from another service's database directly. This is enforced at the infrastructure level: each service has its own PostgreSQL database with its own credentials, and no cross-database foreign keys exist anywhere in the system.

**Rationale:**

- **Independent deployability**: Account-service and transaction-service can be upgraded, scaled, or replaced without coordinating schema changes with other teams.
- **Failure isolation**: A schema migration failure in fraud-service does not affect account-service uptime.
- **Technology freedom**: Each service can evolve its storage independently. Notification-service could move to a document store in the future without impacting audit-service.
- **Clear ownership**: The team owning a service owns its schema. There is no shared schema that requires cross-team coordination for every change.
- **Security boundary**: A compromised transaction-service credential cannot be used to read fraud investigation data.

**Trade-off acknowledged**: Joins across service boundaries are impossible at the database layer. Cross-service queries are handled by API composition in the application layer or by event-driven data replication into read-optimized projections.

---

## Database Inventory

| Service              | Database         | Schema        | Tables                                                                 |
|----------------------|------------------|---------------|------------------------------------------------------------------------|
| account-service      | account_db       | accounts      | accounts, account_balance, account_status_history, outbox_events       |
| transaction-service  | transaction_db   | transactions  | transactions, transaction_audit, transaction_status_history, saga_state, outbox_events |
| fraud-service        | fraud_db         | fraud         | fraud_alerts                                                           |
| notification-service | notification_db  | notifications | notifications                                                          |
| audit-service        | audit_db         | audit         | audit_logs                                                             |

**Schema naming convention**: One schema per service, named after the service's domain (not the service name itself). The schema name is set in `spring.flyway.schemas` and `spring.datasource.hikari.schema` for each service.

---

## Schema Details

### account_db

**Schema**: `accounts`

#### Table: `accounts`

Represents a bank account opened by a customer. One customer may hold multiple accounts of different types and currencies.

| Column           | Type                     | Constraints                                                             | Notes                                          |
|------------------|--------------------------|-------------------------------------------------------------------------|------------------------------------------------|
| id               | UUID                     | PRIMARY KEY                                                             | Generated at application layer (UUID v4)       |
| account_number   | VARCHAR(34)              | NOT NULL, UNIQUE                                                        | IBAN-format or internal format, never reused   |
| account_type     | VARCHAR(20)              | NOT NULL, CHECK (account_type IN ('CHECKING','SAVINGS','BUSINESS'))     | Maps to Java enum AccountType                  |
| customer_id      | UUID                     | NOT NULL                                                                | Logical FK to customer-service; no DB FK       |
| currency         | CHAR(3)                  | NOT NULL                                                                | ISO 4217 code (e.g. USD, EUR, GBP)             |
| status           | VARCHAR(20)              | NOT NULL, CHECK (status IN ('ACTIVE','FROZEN','CLOSED','SUSPENDED'))    | Maps to Java enum AccountStatus                |
| created_at       | TIMESTAMPTZ              | NOT NULL, DEFAULT now()                                                 | UTC; stored as Instant in Java                 |
| updated_at       | TIMESTAMPTZ              | NOT NULL, DEFAULT now()                                                 | Updated on every write                         |
| version          | BIGINT                   | NOT NULL, DEFAULT 0                                                     | Optimistic locking; incremented on each update |

#### Table: `account_balance`

Holds the live financial position of an account. Separated from `accounts` to allow high-frequency balance updates without contending on the full account row.

| Column            | Type          | Constraints                              | Notes                                               |
|-------------------|---------------|------------------------------------------|-----------------------------------------------------|
| id                | UUID          | PRIMARY KEY                              | Generated at application layer                      |
| account_id        | UUID          | NOT NULL, UNIQUE, FK → accounts(id)      | One-to-one with accounts; within the same schema    |
| available_balance | NUMERIC(19,4) | NOT NULL, DEFAULT 0                      | Funds immediately spendable                         |
| ledger_balance    | NUMERIC(19,4) | NOT NULL, DEFAULT 0                      | Total balance including reserved amounts            |
| reserved_amount   | NUMERIC(19,4) | NOT NULL, DEFAULT 0                      | Held for in-flight transactions (saga reservations) |
| last_updated_at   | TIMESTAMPTZ   | NOT NULL, DEFAULT now()                  | Tracks recency of balance data                      |
| version           | BIGINT        | NOT NULL, DEFAULT 0                      | Optimistic locking for concurrent balance updates   |

**Invariant**: `ledger_balance = available_balance + reserved_amount` must hold at all times. Enforced in the application layer (AccountBalanceService) and verified in integration tests.

#### Table: `account_status_history`

Immutable audit trail of all status transitions for an account.

| Column          | Type        | Constraints             | Notes                                   |
|-----------------|-------------|-------------------------|-----------------------------------------|
| id              | UUID        | PRIMARY KEY             | Generated at application layer          |
| account_id      | UUID        | NOT NULL, FK → accounts(id) | Index candidate                     |
| previous_status | VARCHAR(20) | NOT NULL                | Status before the transition            |
| new_status      | VARCHAR(20) | NOT NULL                | Status after the transition             |
| reason          | TEXT        | NULL                    | Human-readable reason (e.g. "KYC fail") |
| changed_by      | UUID        | NOT NULL                | Actor ID (staff or system)              |
| changed_at      | TIMESTAMPTZ | NOT NULL, DEFAULT now() | When the transition occurred            |

#### Table: `outbox_events` (accounts schema)

Transactional outbox pattern implementation. Events written atomically with domain changes; a relay process publishes them to Kafka.

| Column         | Type        | Constraints                                                          | Notes                                          |
|----------------|-------------|----------------------------------------------------------------------|------------------------------------------------|
| id             | UUID        | PRIMARY KEY                                                          | Generated at application layer                 |
| aggregate_type | VARCHAR(100)| NOT NULL                                                             | e.g. "Account"                                 |
| aggregate_id   | UUID        | NOT NULL                                                             | The account ID this event belongs to           |
| event_type     | VARCHAR(100)| NOT NULL                                                             | e.g. "AccountCreated", "AccountFrozen"         |
| payload        | JSONB       | NOT NULL                                                             | Full event body; schema defined per event_type |
| topic          | VARCHAR(200)| NOT NULL                                                             | Kafka topic name                               |
| partition_key  | VARCHAR(200)| NOT NULL                                                             | Usually aggregate_id for ordering              |
| status         | VARCHAR(20) | NOT NULL, CHECK (status IN ('PENDING','PUBLISHED','FAILED'))         | Relay tracks publication state                 |
| retry_count    | INTEGER     | NOT NULL, DEFAULT 0                                                  | Incremented on each failed publish attempt     |
| created_at     | TIMESTAMPTZ | NOT NULL, DEFAULT now()                                              |                                                |
| published_at   | TIMESTAMPTZ | NULL                                                                 | Set when relay confirms Kafka acknowledgement  |

---

### transaction_db

**Schema**: `transactions`

#### Table: `transactions`

Core transaction record. Each row represents one initiated financial movement.

| Column             | Type          | Constraints                                | Notes                                              |
|--------------------|---------------|--------------------------------------------|----------------------------------------------------|
| id                 | UUID          | PRIMARY KEY                                | Generated at application layer                     |
| reference_number   | VARCHAR(50)   | NOT NULL, UNIQUE                           | Human-readable ID presented to customers           |
| transaction_type   | VARCHAR(30)   | NOT NULL                                   | e.g. TRANSFER, DEPOSIT, WITHDRAWAL, PAYMENT        |
| source_account_id  | UUID          | NULL                                       | Null for DEPOSIT (external inflow)                 |
| target_account_id  | UUID          | NULL                                       | Null for WITHDRAWAL (external outflow)             |
| amount             | NUMERIC(19,4) | NOT NULL, CHECK (amount > 0)               | Always positive; direction implied by type         |
| currency           | CHAR(3)       | NOT NULL                                   | ISO 4217                                           |
| status             | VARCHAR(30)   | NOT NULL                                   | INITIATED, PENDING, COMPLETED, FAILED, REVERSED    |
| description        | TEXT          | NULL                                       | Customer-provided memo                             |
| metadata           | JSONB         | NULL                                       | Extensible key-value store (channel, device, etc.) |
| initiated_at       | TIMESTAMPTZ   | NOT NULL, DEFAULT now()                    |                                                    |
| completed_at       | TIMESTAMPTZ   | NULL                                       | Set when saga reaches terminal state               |
| version            | BIGINT        | NOT NULL, DEFAULT 0                        | Optimistic locking                                 |

#### Table: `transaction_audit`

Immutable log of every state change to a transaction row. Written by a Hibernate event listener; never updated or deleted.

| Column         | Type        | Constraints             | Notes                              |
|----------------|-------------|-------------------------|------------------------------------|
| id             | UUID        | PRIMARY KEY             |                                    |
| transaction_id | UUID        | NOT NULL                | Logical FK to transactions(id)     |
| changed_by     | UUID        | NOT NULL                | Actor who caused the change        |
| old_status     | VARCHAR(30) | NULL                    | Null on INSERT                     |
| new_status     | VARCHAR(30) | NOT NULL                |                                    |
| change_reason  | TEXT        | NULL                    |                                    |
| recorded_at    | TIMESTAMPTZ | NOT NULL, DEFAULT now() |                                    |

#### Table: `transaction_status_history`

| Column          | Type        | Constraints             | Notes                               |
|-----------------|-------------|-------------------------|-------------------------------------|
| id              | UUID        | PRIMARY KEY             |                                     |
| transaction_id  | UUID        | NOT NULL                |                                     |
| from_status     | VARCHAR(30) | NOT NULL                |                                     |
| to_status       | VARCHAR(30) | NOT NULL                |                                     |
| transitioned_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |                                     |
| triggered_by    | VARCHAR(100)| NOT NULL                | Service or user that drove the change |

#### Table: `saga_state`

Tracks the progress of a distributed saga coordinating a multi-step transaction (e.g. debit source, fraud check, credit target, notify).

| Column         | Type        | Constraints                                                             | Notes                                         |
|----------------|-------------|-------------------------------------------------------------------------|-----------------------------------------------|
| id             | UUID        | PRIMARY KEY                                                             |                                               |
| transaction_id | UUID        | NOT NULL, UNIQUE                                                        | One saga per transaction                      |
| current_step   | VARCHAR(100)| NOT NULL                                                                | e.g. DEBIT_SOURCE, FRAUD_CHECK, CREDIT_TARGET |
| saga_status    | VARCHAR(30) | NOT NULL, CHECK (saga_status IN ('STARTED','IN_PROGRESS','COMPLETED','COMPENSATING','FAILED')) | |
| step_data      | JSONB       | NOT NULL                                                                | Per-step results and compensation tokens      |
| created_at     | TIMESTAMPTZ | NOT NULL, DEFAULT now()                                                 |                                               |
| updated_at     | TIMESTAMPTZ | NOT NULL, DEFAULT now()                                                 |                                               |

#### Table: `outbox_events` (transactions schema)

Identical structure to accounts.outbox_events. Each service manages its own outbox independently.

---

### fraud_db

**Schema**: `fraud`

#### Table: `fraud_alerts`

One row per fraud evaluation. Created for every transaction that passes through the fraud scoring engine, not only flagged ones.

| Column          | Type          | Constraints             | Notes                                                      |
|-----------------|---------------|-------------------------|------------------------------------------------------------|
| id              | UUID          | PRIMARY KEY             |                                                            |
| transaction_id  | UUID          | NOT NULL                | Logical FK to transactions(id) in transaction_db           |
| account_id      | UUID          | NOT NULL                | Account under review                                       |
| risk_score      | NUMERIC(5,2)  | NOT NULL                | 0.00 to 100.00; higher = more suspicious                   |
| risk_level      | VARCHAR(20)   | NOT NULL                | LOW, MEDIUM, HIGH, CRITICAL                                |
| triggered_rules | JSONB         | NOT NULL                | Array of rule names and their individual scores            |
| decision        | VARCHAR(20)   | NOT NULL                | ALLOW, REVIEW, BLOCK                                       |
| reviewed_by     | UUID          | NULL                    | Staff member UUID; null if auto-decided                    |
| review_notes    | TEXT          | NULL                    | Free-text from human reviewer                              |
| created_at      | TIMESTAMPTZ   | NOT NULL, DEFAULT now() |                                                            |
| reviewed_at     | TIMESTAMPTZ   | NULL                    | When a human completed the review                          |

---

### notification_db

**Schema**: `notifications`

#### Table: `notifications`

| Column       | Type        | Constraints             | Notes                                        |
|--------------|-------------|-------------------------|----------------------------------------------|
| id           | UUID        | PRIMARY KEY             |                                              |
| recipient_id | UUID        | NOT NULL                | Customer or staff member UUID                |
| channel      | VARCHAR(20) | NOT NULL                | EMAIL, SMS, PUSH, IN_APP                     |
| template_id  | VARCHAR(100)| NOT NULL                | References notification template catalogue   |
| payload      | JSONB       | NOT NULL                | Rendered content or template variables       |
| status       | VARCHAR(20) | NOT NULL                | PENDING, SENT, FAILED, CANCELLED             |
| reference_id | UUID        | NULL                    | Source entity (transaction ID, account ID)   |
| retry_count  | INTEGER     | NOT NULL, DEFAULT 0     |                                              |
| created_at   | TIMESTAMPTZ | NOT NULL, DEFAULT now() |                                              |
| sent_at      | TIMESTAMPTZ | NULL                    |                                              |

---

### audit_db

**Schema**: `audit`

#### Table: `audit_logs`

Platform-wide compliance audit trail. All services publish audit events; audit-service consumes them from Kafka and persists here.

| Column         | Type        | Constraints             | Notes                                                    |
|----------------|-------------|-------------------------|----------------------------------------------------------|
| id             | UUID        | PRIMARY KEY             |                                                          |
| event_type     | VARCHAR(100)| NOT NULL                | e.g. ACCOUNT_CREATED, TRANSACTION_REVERSED               |
| severity       | VARCHAR(20) | NOT NULL                | INFO, WARNING, ERROR, CRITICAL                           |
| actor_id       | UUID        | NOT NULL                | Who performed the action                                 |
| actor_type     | VARCHAR(50) | NOT NULL                | CUSTOMER, STAFF, SYSTEM                                  |
| resource_type  | VARCHAR(100)| NOT NULL                | e.g. Account, Transaction, FraudAlert                    |
| resource_id    | UUID        | NOT NULL                | PK of the affected resource                              |
| action         | VARCHAR(100)| NOT NULL                | CREATE, UPDATE, DELETE, FREEZE, APPROVE, REJECT, etc.    |
| description    | TEXT        | NULL                    | Human-readable summary                                   |
| old_value      | JSONB       | NULL                    | State before the action; null for CREATE                 |
| new_value      | JSONB       | NULL                    | State after the action; null for DELETE                  |
| metadata       | JSONB       | NULL                    | IP address, user agent, session ID, etc.                 |
| source_service | VARCHAR(100)| NOT NULL                | Which service emitted this event                         |
| correlation_id | UUID        | NULL                    | Ties events from a single business operation together    |
| occurred_at    | TIMESTAMPTZ | NOT NULL                | When the action happened in the originating service      |
| recorded_at    | TIMESTAMPTZ | NOT NULL, DEFAULT now() | When audit-service persisted this record                 |

---

## Cross-Service Relationships

Because no cross-database foreign keys exist, logical relationships are maintained through shared UUIDs and application-layer integrity.

| Relationship                              | Mechanism                                              |
|-------------------------------------------|--------------------------------------------------------|
| transaction → account (source/target)     | account_id UUID stored in transactions; verified via account-service API before commit |
| fraud_alert → transaction                 | transaction_id UUID; alert created via Kafka event from transaction-service |
| audit_log → any resource                  | resource_type + resource_id composite; no referential integrity enforced |
| notification → transaction or account     | reference_id UUID; optional, may be null for system notifications |
| saga_state → transaction                  | transaction_id UUID; within the same database, enforced by unique constraint |
| outbox_event → aggregate                  | aggregate_type + aggregate_id; relay does not validate existence |

---

## Design Decisions

### JSONB Column Usage

JSONB is used deliberately for data that is: (a) schema-variable per record, (b) opaque to SQL queries most of the time, or (c) better modelled as a document than as relational columns.

| Column          | Table           | Rationale                                                                   |
|-----------------|-----------------|-----------------------------------------------------------------------------|
| metadata        | transactions    | Channel (mobile/web/API), device fingerprint, IP; fields vary by channel    |
| triggered_rules | fraud_alerts    | Rule set changes over time; storing as JSONB avoids schema churn            |
| step_data       | saga_state      | Each saga step stores different output; no fixed schema across steps        |
| old_value       | audit_logs      | Snapshot of any resource type; typed by resource_type column                |
| new_value       | audit_logs      | Post-action snapshot; same rationale                                        |
| metadata        | audit_logs      | Context fields (IP, session) that vary by actor_type                        |
| payload         | outbox_events   | Full event body; schema varies per event_type                               |
| payload         | notifications   | Template variables or rendered content; varies per template_id              |

JSONB is indexed with GIN where queries filter on JSON contents. See `indexing-strategy.md`.

### UUID Primary Keys

All PKs are UUID v4 values generated at the application layer (`UUID.randomUUID()` in Java). Advantages:

- No round-trip to the database to obtain a generated sequence value.
- PKs are safe to generate in distributed services before the database row exists (useful for saga orchestration).
- No information leakage: sequential integer IDs reveal record counts and creation order to external callers.

**Consequence**: UUIDs are larger than integers and random UUIDs cause B-tree index fragmentation under high insert volume. This is acceptable for current projected write rates. If insert volume exceeds 10,000 rows/second on any single table, UUIDv7 (time-ordered) can be adopted without changing the column type.

### Optimistic Locking

The `version` column on `accounts`, `account_balance`, and `transactions` enables optimistic locking via Spring Data JPA / Hibernate `@Version`. When two concurrent requests read the same row at version N, both attempt `UPDATE ... WHERE version = N`. Only one succeeds; the other receives an `OptimisticLockingFailureException` and must retry. This is preferred over pessimistic locking (`SELECT FOR UPDATE`) because it avoids holding locks across network calls (e.g. during the saga's fraud-check step).

### Timestamp Strategy

All timestamp columns are `TIMESTAMPTZ` (timestamp with time zone). PostgreSQL stores these as UTC internally. The Java mapping uses `java.time.Instant` (not `LocalDateTime`), configured in `application.yml` with `spring.jpa.properties.hibernate.jdbc.time_zone=UTC`. This ensures consistent behavior regardless of server timezone settings and eliminates ambiguity around daylight saving time transitions.

### Enum Strategy

Java enums (AccountType, AccountStatus, TransactionStatus, etc.) are stored as `VARCHAR` columns with PostgreSQL `CHECK` constraints. This approach is preferred over PostgreSQL native `ENUM` types because:

- Adding a new enum value requires only an `ALTER TABLE ... ADD CONSTRAINT` change; PostgreSQL native ENUM requires `ALTER TYPE`, which takes an `AccessExclusiveLock`.
- The column value is readable in SQL queries without casting.
- JPA `@Enumerated(EnumType.STRING)` maps cleanly with no additional converter needed.

### Schema Naming Conventions

Each service's Flyway configuration sets `spring.flyway.schemas=<domain_schema>`. This creates a namespace within the database that all tables belong to. The search path for the service's connection pool is set to the same schema, so unqualified table references work in application SQL without a schema prefix. The schema name reflects the service's domain (e.g. `accounts` rather than `account_service`), keeping it stable even if the service is renamed or restructured.

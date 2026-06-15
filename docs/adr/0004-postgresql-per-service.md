# ADR-0004: PostgreSQL Database per Service

**Status**: Accepted

**Date**: 2024-01-20

**Deciders**: Platform Architecture Team, Backend Engineering Lead, DevOps Lead

---

## Context

The Banking Platform consists of six microservices: `api-gateway`, `account-service`, `transaction-service`, `fraud-service`, `notification-service`, and `audit-service`. Each service owns a distinct domain with its own data model. Before beginning development, the team needed to decide on a database architecture that governs how services access and store data.

The key forces driving this decision:

- **Independent deployability**: Services must deploy independently without coordinating schema changes across teams.
- **Failure isolation**: A database problem in one service must not cascade to other services.
- **Data ownership**: Each service should be the single authoritative source for its domain data. No service should write to another service's tables.
- **Regulatory compliance**: Banking data has retention and audit requirements that differ by domain (e.g., transaction records: 7 years; notification logs: 30 days).
- **Technology fit**: All six services are Java/Spring Boot applications with relational data models. The team has strong PostgreSQL expertise. No service has access patterns that clearly favor a non-relational store at current scale.
- **Operational simplicity at current scale**: The platform is not yet at a scale that justifies polyglot persistence complexity.

Three options were formally evaluated.

---

## Decision

We will use **one PostgreSQL 16 database instance per service**, with each service owning its own database. No service may connect directly to another service's database. Cross-service data access must occur only through published APIs or Kafka events.

The database-to-service mapping is:

| Service | Database Name | Port (local-dev) | Schema Owner |
|---|---|---|---|
| account-service | `account_db` | 5432 | account-service exclusively |
| transaction-service | `transaction_db` | 5433 | transaction-service exclusively |
| fraud-service | `fraud_db` | 5434 | fraud-service exclusively |
| notification-service | `notification_db` | 5435 | notification-service exclusively |
| audit-service | `audit_db` | 5436 | audit-service exclusively |

The `api-gateway` does not own a persistent database. JWT refresh token blocklist is stored in `account_db` under the `account-service`'s ownership since account management governs authentication state.

Each database is managed exclusively by its owning service via **Flyway** versioned migrations. No other service, DBA script, or tooling may apply DDL to a service's database outside of the Flyway migration chain.

### Environment Topology

| Environment | Database Topology | Notes |
|---|---|---|
| local-dev | 5 separate PostgreSQL containers (Docker Compose) | Each service has its own named volume |
| docker-dev | Same as local-dev | Fully containerized; no host PostgreSQL needed |
| staging | 5 AWS RDS PostgreSQL 16 instances (db.t3.medium) | Automated daily backups, 7-day PITR |
| production | 5 AWS RDS PostgreSQL 16 instances (db.r6g.large) | Multi-AZ, automated snapshots, 35-day PITR |

---

## Consequences

### Positive

- **Independent schema evolution**: Each team adds columns, creates indexes, or restructures tables on its own release schedule without coordinating with other teams. Flyway migrations run at service startup and are scoped to the owning service's database. A breaking schema change in `transaction_db` does not require a freeze on `account_db` deployments.

- **Independent scaling**: A transaction volume spike requiring read replicas or vertical scaling on `transaction_db` has no effect on `account_db`. Each database is right-sized according to its own load profile and growth curve.

- **Failure isolation**: A PostgreSQL outage affecting `fraud_db` prevents fraud checks but does not prevent customers from viewing account balances (served by `account_db`) or `notification-service` from sending emails (served by `notification_db`). Blast radius is bounded per service.

- **Clear data ownership**: There is never ambiguity about which service owns a table or is responsible for its consistency. The service that owns the database is the single writer for its domain. No implicit cross-service coupling via shared tables.

- **Independent backup and recovery**: `audit_db` requires longer retention (7 years for compliance) than `notification_db` (30 days). Each database has its own backup policy configured independently at the infrastructure level.

- **Security boundary**: Database credentials are service-specific secrets. A compromised `notification-service` credential cannot be used to read `transaction_db`. The principle of least privilege applies at the database level.

- **Independent Flyway migration history**: Each service tracks its own `flyway_schema_history` table. Migrations never conflict across services.

### Negative

- **No cross-service SQL joins**: Queries that would naturally JOIN tables across service boundaries (e.g., fetching account holder name alongside a transaction record) must instead denormalize data into Kafka events or make synchronous REST calls. This increases event payload size and introduces eventual consistency that must be designed for explicitly.

- **More infrastructure to operate**: Six database instances require six backup configurations, six sets of credentials to rotate, six connection pool configurations, and six CloudWatch/Prometheus monitoring targets. This is a meaningful operational overhead increase versus a single shared database. Addressed by infrastructure-as-code (Terraform) that provisions all instances from a common module.

- **More complex local development setup**: New engineers must start six PostgreSQL containers via Docker Compose rather than connecting to one database. The `docker compose up` startup time is longer (~30s vs ~5s). Addressed by a single `make dev-up` command that starts everything.

- **Data duplication is required**: Some reference data (e.g., account balance denormalized into transaction records for the audit log) is stored in multiple databases. This is intentional but requires careful event-driven synchronization to avoid stale reads.

- **Distributed queries are expensive**: Analytical queries spanning multiple services (e.g., "show all activity for user X across accounts, transactions, and notifications") cannot be served by a single SQL query. These require either an event-driven read model (CQRS projection) or a separate analytics pipeline fed by Kafka. This is deferred to a future ADR.

### Neutral

- Flyway migration history is tracked per database (each `flyway_schema_history` table is independent). This is neither a benefit nor a drawback — it is a natural consequence of the architecture.

- Each service runs its Flyway migrations at startup via `spring.flyway.enabled=true`. This means a deployment that includes a migration will have a brief window where the new code is running against the old schema during startup. Migrations must be backward-compatible with the N-1 version of the service (see rollout strategy documentation).

---

## Alternatives Considered

### Alternative A: Shared PostgreSQL Database with Per-Service Schemas

A single PostgreSQL instance with multiple schemas (`account_schema`, `transaction_schema`, etc.). Services connect to the same host but use different schema search paths and credentials.

**Rejected because**:
- **Single point of failure**: One database outage takes down all six services simultaneously. This is unacceptable for a banking platform.
- **Tight coupling via shared instance**: A long-running VACUUM, a table lock, or a runaway query in `transaction_schema` degrades performance for all other services on the same instance.
- **Schema conflict risk**: Multiple teams applying Flyway migrations to the same PostgreSQL instance risks migration version conflicts (e.g., both `account-service` and `transaction-service` try to create `V1__init.sql`).
- **Shared connection pool**: Connection exhaustion in `fraud-service` during a fraud spike could starve `account-service` of connections.
- **Scaling bottleneck**: The entire instance must be vertically scaled even if only `transaction_db` is under load.

This option was discussed and eliminated early in planning. It provides operational simplicity of one instance but recreates the tight coupling that microservices are meant to eliminate.

### Alternative B: Polyglot Persistence

Allow each service to choose its own storage technology: Redis for `fraud-service` (fast key-value lookups for rule caching), MongoDB for `notification-service` (flexible template document model), Cassandra for `audit-service` (append-only time-series), PostgreSQL for `account-service` and `transaction-service`.

**Rejected because**:
- **Operational complexity exceeds benefit at current scale**: Operating five distinct database technologies requires expertise across all five. The team has deep PostgreSQL knowledge and no production experience with Cassandra or MongoDB at this time.
- **Not justified at current transaction volumes**: PostgreSQL handles all six services' data models efficiently at the projected scale of the next 18 months. The access patterns do not yet clearly favor non-relational stores.
- **Tooling fragmentation**: Monitoring, backup, credential rotation, and disaster recovery procedures would require supporting five different database systems, multiplying operational runbook complexity.

**Deferred, not permanently rejected**: If `audit-service` grows to hundreds of millions of rows with primarily time-series access patterns, migrating it to TimescaleDB or a dedicated time-series store is a valid future option. This decision would be captured in a new ADR superseding the relevant portion of this one.

---

## Compliance Notes

- **Data residency**: Each service database can be placed in the required geographic AWS region independently. If regulatory requirements mandate that transaction data reside in the EU while notification logs can be stored in the US, this architecture accommodates that without changes to other services.

- **Audit log retention**: `audit_db` is configured with a 7-year automated backup retention policy per financial regulations. Other databases use 35-day PITR with 90-day automated snapshots. Per-service database instances make differentiated retention policies straightforward to configure.

- **PCI-DSS scope**: Payment-sensitive data is isolated to specific service databases, minimizing PCI scope. A shared database would expand PCI audit scope to all services on the instance.

- **Encryption at rest**: All RDS instances are encrypted using AWS KMS with service-specific KMS keys.

---

## References

- [Martin Fowler — Database per Service Pattern](https://martinfowler.com/articles/microservices.html#DecentralizedDataManagement)
- [Chris Richardson — Microservices Patterns: Database per Service](https://microservices.io/patterns/data/database-per-service.html)
- Internal spike: `docs/spikes/2024-01-database-options.md`
- Related: ADR-0002 (Orchestration Saga) — necessitated by this decision since cross-service SQL transactions are not possible

# 0004. PostgreSQL with one database per service

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

Each microservice must own its data so that it can change its schema and deploy independently. If
two services share tables, a migration in one can break the other, and the "service boundary" is only
on paper. At the same time this is a single-developer project that must run on a laptop.

## Decision

We will use **PostgreSQL** with **one logical database per service** on **one Postgres instance**:

| Service | Database |
|---------|----------|
| account-service | `accounts_db` |
| transaction-service | `transactions_db` |
| fraud-service | `fraud_db` |
| notification-service | `notifications_db` |
| audit-service | `audit_db` |

- Connection: `jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_NAME}` with
  `${DB_USERNAME:banking}` / `${DB_PASSWORD:banking}`.
- Each service owns its schema through **Flyway** migrations in `src/main/resources/db/migration`.
  Hibernate runs with `ddl-auto: validate` (it never changes the schema).
- No service reads another service's database. Data is shared only through REST APIs or Kafka events
  (for example notification-service keeps its own copy of customer contact details from `ACCOUNT_CREATED`).
- The api-gateway has no database.

## Consequences

**Positive**
- Strong ownership boundaries; services can evolve schemas independently.
- One container locally — cheap and simple. In production each database can be moved to its own
  instance without code changes (only `DB_HOST` changes).
- PostgreSQL gives ACID transactions, row-level locking (`SELECT ... FOR UPDATE`) for balances,
  JSON support and triggers (used for immutable audit logs).

**Negative**
- One shared instance is a single point of failure and a "noisy neighbour" risk locally.
- No cross-service joins or foreign keys; reports need events or API composition.
- Data is duplicated (eventually consistent copies).

## Alternatives considered

- **One shared database/schema for all services** — easiest joins, but couples every service. Rejected.
- **One Postgres instance per service** — the production target, but too heavy for local development.
- **Schema per service in one database** — similar isolation, but separate databases make it harder to
  accidentally cross boundaries and map 1:1 to separate instances later.
- **NoSQL (e.g. MongoDB)** — weaker multi-row transactions; money needs ACID.

# Database migrations

**There are no migrations in this folder on purpose.** Each microservice owns
its own database and its own schema, and the schema is versioned with
[Flyway](https://documentation.red-gate.com/flyway) *inside the service module*.

| Service | Database | Migrations |
|---|---|---|
| account-service | `accounts_db` | `account-service/src/main/resources/db/migration/` |
| transaction-service | `transactions_db` | `transaction-service/src/main/resources/db/migration/` |
| fraud-service | `fraud_db` | `fraud-service/src/main/resources/db/migration/` |
| notification-service | `notifications_db` | `notification-service/src/main/resources/db/migration/` |
| audit-service | `audit_db` | `audit-service/src/main/resources/db/migration/` |

The api-gateway has no database.

## How it fits together

1. **Postgres container** (`docker/postgresql`) starts once with an empty volume and runs
   `init/01-create-extensions.sql` (pgcrypto, uuid-ossp, pg_trgm) and
   `init/02-create-schemas.sh`, which creates the five **empty** databases above,
   owned by the app user (`banking`).
2. **Each service** starts, Flyway connects to *its* database and applies any
   `V<n>__<description>.sql` file that is not yet recorded in the
   `flyway_schema_history` table.
3. Hibernate then runs with `ddl-auto: validate` — it only *checks* that the
   entities match the tables; it never changes the schema.

## Rules

- **Never edit a migration that has already run** anywhere shared. Flyway stores a
  checksum and the service will refuse to start. Add a new `V<n+1>__...sql` instead.
- File names: `V<version>__<snake_case_description>.sql`, e.g. `V2__add_account_nickname.sql`.
- One logical change per migration; make them backwards compatible when possible
  (add column nullable → backfill → add constraint in a later version) so a rolling
  deploy with old + new instances keeps working.
- A service must never read or write another service's database. Share data through
  Kafka events or REST calls.
- Seed data for local development lives in `../seeds/dev-seed-data.sql`, not in
  migrations (production must not get demo rows).

## Useful commands

```bash
# open psql inside the container
docker exec -it banking-postgres psql -U banking -d accounts_db

# what has Flyway applied?
docker exec -it banking-postgres psql -U banking -d accounts_db \
  -c "select version, description, success, installed_on from flyway_schema_history order by installed_rank"

# start over with empty databases (deletes ALL local data)
cd docker && docker compose down -v && docker compose up -d --build
```

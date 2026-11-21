# Database Migration Strategy

Every service owns its schema and manages it with **Flyway**. Hibernate never changes the schema
(`spring.jpa.hibernate.ddl-auto: validate`) — it only checks at startup that entities match the tables.

## 1. Where migrations live

```
account-service/src/main/resources/db/migration/V1__create_accounts_schema.sql
transaction-service/src/main/resources/db/migration/V1__create_transactions_schema.sql
fraud-service/src/main/resources/db/migration/V1__create_fraud_schema.sql
notification-service/src/main/resources/db/migration/V1__create_notifications_schema.sql
audit-service/src/main/resources/db/migration/V1__create_audit_schema.sql
```

Dependencies (in each service pom): `org.flywaydb:flyway-core` and
`org.flywaydb:flyway-database-postgresql` (versions managed by Spring Boot).

On startup Spring Boot runs Flyway **before** JPA validates the schema. Flyway records what it applied
in the table `flyway_schema_history` in each database.

The databases themselves (`accounts_db`, ...) are created by the Postgres container init scripts in
`docker/postgresql/`; Flyway only creates tables inside them.

## 2. Naming

```
V<version>__<description>.sql      e.g. V2__add_customer_phone_index.sql
```

- Versions are increasing integers per service (`V1`, `V2`, ...). Two developers creating `V2` at the
  same time is a merge conflict — renumber before merging.
- Use lowercase, underscore-separated descriptions.
- Repeatable migrations (`R__...sql`) are only for views/functions that can be safely recreated.

## 3. Golden rules

1. **Never edit an applied migration.** Flyway checks checksums; editing `V1` after it ran fails
   startup with a checksum mismatch. Write `V2` instead.
   (During early local development you may reset your own database — see section 6.)
2. **One logical change per migration**, small enough to review.
3. **Migrations must be backward compatible with the currently running code** (see section 4), so a
   rolling deploy works.
4. Entity changes and the migration that supports them go in the **same pull request**.
5. Never put data that differs per environment (passwords, demo users) in migrations. Dev seed data
   lives in `infrastructure/postgresql/seeds/`.

## 4. Expand / contract for breaking changes

To rename `customer_phone` to `phone_number` without downtime:

| Step | Release | Migration | Code |
|------|---------|-----------|------|
| Expand | N | `V5__add_phone_number.sql`: add nullable `phone_number`, backfill from `customer_phone` | Writes both columns, reads old |
| Migrate | N+1 | – | Reads new column, writes both |
| Contract | N+2 | `V6__drop_customer_phone.sql` | Uses only `phone_number` |

Same idea for:
- **Adding a NOT NULL column**: add nullable → backfill → add `NOT NULL` in a later migration (or add
  with a `DEFAULT`).
- **Dropping a column**: stop using it in code first, drop it one release later.
- **Large indexes**: `CREATE INDEX CONCURRENTLY` in its own migration with
  `-- flyway:executeInTransaction=false` at the top (PostgreSQL does not allow it inside a transaction).

## 5. Special cases

- **audit_db**: `audit_logs` has triggers blocking `UPDATE`/`DELETE`/`TRUNCATE`. A migration that must
  change existing rows (rare — normally forbidden) must explicitly drop and recreate the trigger in the
  same migration and be approved as a compliance change.
- **Money columns**: never change `NUMERIC(19,2)` precision downward.
- **Enums stored as VARCHAR with CHECK**: adding a value = new migration that drops and recreates the
  CHECK constraint, deployed **before** the code that writes the new value.

## 6. Local development

```bash
# See what Flyway has applied
docker compose -f docker/docker-compose.dev.yml exec postgres psql -U banking -d accounts_db \
  -c "SELECT installed_rank, version, description, success FROM flyway_schema_history;"

# Reset ONE service's database (local only! destroys data)
docker compose -f docker/docker-compose.dev.yml exec postgres psql -U banking -d postgres \
  -c "DROP DATABASE accounts_db WITH (FORCE);" -c "CREATE DATABASE accounts_db OWNER banking;"
# restart account-service -> Flyway re-applies V1..Vn
```

Or remove the Postgres volume to reset everything:
`docker compose -f docker/docker-compose.dev.yml down -v`.

## 7. Tests

Unit and slice tests do not need Postgres (H2 or mocks). Migration SQL is verified when the service
starts against the real Postgres in docker-compose; CI runs a startup smoke test (see
[ci-cd-pipeline](../deployment/ci-cd-pipeline.md)). Adding Testcontainers-based migration tests is a
recommended next step.

## 8. Rollback

Flyway Community has no automatic "undo". To roll back:
- Prefer **roll forward**: write a new migration that fixes the problem.
- Because migrations are backward compatible (section 4), the previous application version can run on
  the new schema, so rolling back the **code** does not require rolling back the **schema**.
- For a destructive mistake, restore from backup (see [database-failover](../runbooks/database-failover.md)).

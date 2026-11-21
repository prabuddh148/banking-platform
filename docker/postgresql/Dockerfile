# syntax=docker/dockerfile:1.7
# PostgreSQL for the banking platform.
# One server, one database per service (database-per-service pattern):
#   accounts_db, transactions_db, fraud_db, notifications_db, audit_db
# Scripts in /docker-entrypoint-initdb.d run ONCE, on the first start with an
# empty data volume (delete the volume to re-run them: docker compose down -v).
FROM postgres:16.4-alpine

COPY --chmod=0755 init/ /docker-entrypoint-initdb.d/

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=10 \
  CMD pg_isready -U "${POSTGRES_USER:-banking}" -d "${POSTGRES_DB:-banking}" || exit 1

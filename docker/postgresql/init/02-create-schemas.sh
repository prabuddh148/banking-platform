#!/bin/bash
# -----------------------------------------------------------------------------
# 02-create-schemas.sh
# Creates one database per microservice, owned by the application user.
# Runs once on first container start (empty data volume).
#
# The application user is POSTGRES_USER (default "banking"). Each service then
# creates its own tables with Flyway (src/main/resources/db/migration).
#
# Override the list with APP_DATABASES="a_db b_db" if needed.
# -----------------------------------------------------------------------------
set -euo pipefail

APP_USER="${APP_DB_USER:-${POSTGRES_USER}}"
DATABASES="${APP_DATABASES:-accounts_db transactions_db fraud_db notifications_db audit_db}"

for db in ${DATABASES}; do
  exists=$(psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '${db}'")
  if [ "${exists}" = "1" ]; then
    echo "[init] database ${db} already exists - skipping"
  else
    echo "[init] creating database ${db} (owner ${APP_USER})"
    psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
      -c "CREATE DATABASE \"${db}\" OWNER \"${APP_USER}\" ENCODING 'UTF8' TEMPLATE template1"
  fi

  # The owner can create tables in the public schema (needed on PG15+).
  psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${db}" <<-EOSQL
    GRANT ALL PRIVILEGES ON DATABASE "${db}" TO "${APP_USER}";
    ALTER SCHEMA public OWNER TO "${APP_USER}";
    GRANT ALL ON SCHEMA public TO "${APP_USER}";
EOSQL
done

echo "[init] databases ready: ${DATABASES}"

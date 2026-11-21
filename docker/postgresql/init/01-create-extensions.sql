-- -----------------------------------------------------------------------------
-- 01-create-extensions.sql
-- Runs once on first container start (empty data volume), as the superuser
-- defined by POSTGRES_USER, against the POSTGRES_DB database.
--
-- We install the extensions into template1 as well: every database created
-- afterwards (02-create-schemas.sh creates the per-service DBs) is copied from
-- template1, so it inherits these extensions automatically.
-- -----------------------------------------------------------------------------

-- Default database (POSTGRES_DB)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- fast LIKE/ILIKE searches (names, emails)

-- Template used for every new database
\connect template1
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

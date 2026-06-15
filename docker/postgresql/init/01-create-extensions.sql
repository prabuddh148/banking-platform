-- =============================================================================
-- PostgreSQL Extensions Initialization
-- =============================================================================
-- This script runs automatically when each PostgreSQL container is first
-- created. It enables extensions required by the banking platform.
--
-- Executed in: account_db, transaction_db, fraud_db, notification_db, audit_db
-- =============================================================================

-- UUID generation support (used for primary keys across all services)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Trigram-based text search (used for full-text search on account names,
-- transaction descriptions, and audit log messages)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- pg_stat_statements: tracks SQL query execution statistics for performance
-- analysis and slow query detection
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- =============================================================================
-- Verify installations
-- =============================================================================
DO $$
DECLARE
    ext_name TEXT;
    ext_list TEXT[] := ARRAY['uuid-ossp', 'pg_trgm', 'pg_stat_statements'];
BEGIN
    FOREACH ext_name IN ARRAY ext_list LOOP
        IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = ext_name) THEN
            RAISE NOTICE 'Extension "%" is installed.', ext_name;
        ELSE
            RAISE WARNING 'Extension "%" could NOT be installed.', ext_name;
        END IF;
    END LOOP;
END $$;

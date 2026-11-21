-- =============================================================================
-- dev-seed-data.sql - OPTIONAL demo data for LOCAL DEVELOPMENT ONLY.
--
-- Gives the demo users (issued by the api-gateway login) some accounts so the
-- frontend has something to show right away:
--   rahul / password -> CUST-1001  (Rahul Sharma)  : 1 SAVINGS + 1 CURRENT account
--   priya / password -> CUST-1002  (Priya Patel)   : 1 SAVINGS account
--
-- Matches the Flyway V1 schemas:
--   account-service      V1__create_accounts_schema.sql      (accounts_db)
--   notification-service V1__create_notifications_schema.sql (notifications_db)
--
-- RUN IT AFTER the services have started once (Flyway must have created the
-- tables). It is idempotent (fixed ids + ON CONFLICT DO NOTHING):
--
--   docker exec -i banking-postgres psql -U banking -d postgres \
--     < infrastructure/postgresql/seeds/dev-seed-data.sql
--
-- NOTE: rows inserted here bypass the services, so NO Kafka events are
-- produced (no ACCOUNT_CREATED, no welcome email, no audit log entry). For a
-- realistic flow, create accounts through the API instead:
--   POST /api/v1/accounts  (as rahul / priya)
-- =============================================================================

\set ON_ERROR_STOP on

-- -----------------------------------------------------------------------------
-- accounts_db (account-service)
-- -----------------------------------------------------------------------------
\connect accounts_db

BEGIN;

INSERT INTO accounts (id, account_number, customer_id, customer_name, customer_email, customer_phone,
                      account_type, status, currency, created_at, updated_at, version)
VALUES
    ('11111111-1111-4111-8111-000000000001', 'ACC1000000001', 'CUST-1001', 'Rahul Sharma',
     'rahul.sharma@example.com', '+919800000001', 'SAVINGS', 'ACTIVE', 'INR', now(), now(), 0),
    ('11111111-1111-4111-8111-000000000002', 'ACC1000000002', 'CUST-1001', 'Rahul Sharma',
     'rahul.sharma@example.com', '+919800000001', 'CURRENT', 'ACTIVE', 'INR', now(), now(), 0),
    ('22222222-2222-4222-8222-000000000001', 'ACC2000000001', 'CUST-1002', 'Priya Patel',
     'priya.patel@example.com', '+919800000002', 'SAVINGS', 'ACTIVE', 'INR', now(), now(), 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO account_balances (account_id, ledger_balance, reserved_amount, currency, last_updated, version)
VALUES
    ('11111111-1111-4111-8111-000000000001', 250000.00, 0.00, 'INR', now(), 0),
    ('11111111-1111-4111-8111-000000000002',  75000.00, 0.00, 'INR', now(), 0),
    ('22222222-2222-4222-8222-000000000001', 120000.00, 0.00, 'INR', now(), 0)
ON CONFLICT (account_id) DO NOTHING;

-- "Account opened" entry in the status history (previous_status NULL = new account).
INSERT INTO account_status_history (id, account_id, previous_status, new_status, reason, changed_by, changed_at)
VALUES
    ('11111111-1111-4111-8111-100000000001', '11111111-1111-4111-8111-000000000001', NULL, 'ACTIVE', 'Account opened (dev seed)', 'SEED', now()),
    ('11111111-1111-4111-8111-100000000002', '11111111-1111-4111-8111-000000000002', NULL, 'ACTIVE', 'Account opened (dev seed)', 'SEED', now()),
    ('22222222-2222-4222-8222-100000000001', '22222222-2222-4222-8222-000000000001', NULL, 'ACTIVE', 'Account opened (dev seed)', 'SEED', now())
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- -----------------------------------------------------------------------------
-- notifications_db (notification-service)
-- notification-service normally learns account owners from ACCOUNT_CREATED
-- events; since the seed skips Kafka, register the contacts directly so
-- TRANSACTION_COMPLETED / FAILED notifications reach the right person.
-- -----------------------------------------------------------------------------
\connect notifications_db

BEGIN;

INSERT INTO account_contacts (account_id, account_number, customer_id, customer_name, email, phone, created_at, updated_at)
VALUES
    ('11111111-1111-4111-8111-000000000001', 'ACC1000000001', 'CUST-1001', 'Rahul Sharma', 'rahul.sharma@example.com', '+919800000001', now(), now()),
    ('11111111-1111-4111-8111-000000000002', 'ACC1000000002', 'CUST-1001', 'Rahul Sharma', 'rahul.sharma@example.com', '+919800000001', now(), now()),
    ('22222222-2222-4222-8222-000000000001', 'ACC2000000001', 'CUST-1002', 'Priya Patel',  'priya.patel@example.com',  '+919800000002', now(), now())
ON CONFLICT (account_id) DO NOTHING;

COMMIT;

-- Done. Check with:
--   docker exec -it banking-postgres psql -U banking -d accounts_db \
--     -c "select a.account_number, a.customer_id, b.ledger_balance from accounts a join account_balances b on b.account_id = a.id"

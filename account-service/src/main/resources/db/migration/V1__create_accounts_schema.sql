-- account-service schema (database accounts_db)

-- Bank accounts. Money lives in account_balances (same primary key).
CREATE TABLE accounts (
    id              UUID         PRIMARY KEY,
    account_number  VARCHAR(13)  NOT NULL,
    customer_id     VARCHAR(64)  NOT NULL,
    customer_name   VARCHAR(150) NOT NULL,
    customer_email  VARCHAR(255) NOT NULL,
    customer_phone  VARCHAR(20),
    account_type    VARCHAR(20)  NOT NULL,
    status          VARCHAR(20)  NOT NULL,
    currency        VARCHAR(3)   NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL,
    version         BIGINT       NOT NULL DEFAULT 0,
    CONSTRAINT uk_accounts_account_number UNIQUE (account_number),
    CONSTRAINT ck_accounts_type CHECK (account_type IN ('SAVINGS', 'CURRENT', 'FIXED_DEPOSIT')),
    CONSTRAINT ck_accounts_status CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED'))
);

CREATE INDEX idx_accounts_customer_id ON accounts (customer_id);
CREATE INDEX idx_accounts_status ON accounts (status);

-- Balance of each account. ledger = booked money; available = ledger - reserved.
CREATE TABLE account_balances (
    account_id       UUID           PRIMARY KEY REFERENCES accounts (id),
    ledger_balance   NUMERIC(19, 2) NOT NULL DEFAULT 0,
    reserved_amount  NUMERIC(19, 2) NOT NULL DEFAULT 0,
    currency         VARCHAR(3)     NOT NULL,
    last_updated     TIMESTAMP WITH TIME ZONE NOT NULL,
    version          BIGINT         NOT NULL DEFAULT 0,
    CONSTRAINT ck_balances_ledger_non_negative CHECK (ledger_balance >= 0),
    CONSTRAINT ck_balances_reserved_non_negative CHECK (reserved_amount >= 0),
    CONSTRAINT ck_balances_reserved_le_ledger CHECK (reserved_amount <= ledger_balance)
);

-- Audit trail of status changes (opened / frozen / unfrozen / closed).
CREATE TABLE account_status_history (
    id               UUID         PRIMARY KEY,
    account_id       UUID         NOT NULL REFERENCES accounts (id),
    previous_status  VARCHAR(20),
    new_status       VARCHAR(20)  NOT NULL,
    reason           VARCHAR(255),
    changed_by       VARCHAR(64)  NOT NULL,
    changed_at       TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_status_history_account ON account_status_history (account_id, changed_at);

-- Holds on funds (POST /accounts/{id}/balance/reserve).
CREATE TABLE balance_reservations (
    id              UUID           PRIMARY KEY,
    account_id      UUID           NOT NULL REFERENCES accounts (id),
    transaction_id  VARCHAR(64)    NOT NULL,
    amount          NUMERIC(19, 2) NOT NULL,
    status          VARCHAR(20)    NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL,
    closed_at       TIMESTAMP WITH TIME ZONE,
    CONSTRAINT uk_reservation_account_txn UNIQUE (account_id, transaction_id),
    CONSTRAINT ck_reservation_amount_positive CHECK (amount > 0),
    CONSTRAINT ck_reservation_status CHECK (status IN ('ACTIVE', 'RELEASED', 'CONSUMED'))
);

-- Ledger of BALANCE_UPDATE_REQUESTED events already handled (idempotency, one row per transaction).
CREATE TABLE processed_transactions (
    transaction_id             VARCHAR(64)    PRIMARY KEY,
    transaction_type           VARCHAR(20),
    outcome                    VARCHAR(20)    NOT NULL,
    error_code                 VARCHAR(50),
    source_account_id          UUID,
    destination_account_id     UUID,
    amount                     NUMERIC(19, 2),
    source_balance_after       NUMERIC(19, 2),
    destination_balance_after  NUMERIC(19, 2),
    processed_at               TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_processed_source ON processed_transactions (source_account_id);
CREATE INDEX idx_processed_destination ON processed_transactions (destination_account_id);

-- Transactional outbox: events waiting to be relayed to Kafka.
CREATE TABLE outbox_events (
    id              UUID         PRIMARY KEY,
    aggregate_type  VARCHAR(50)  NOT NULL,
    aggregate_id    VARCHAR(64)  NOT NULL,
    event_type      VARCHAR(50)  NOT NULL,
    topic           VARCHAR(100) NOT NULL,
    payload         TEXT         NOT NULL,
    status          VARCHAR(20)  NOT NULL,
    attempts        INTEGER      NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL,
    published_at    TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_outbox_pending ON outbox_events (status, created_at);

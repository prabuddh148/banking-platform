-- transaction-service schema (PostgreSQL). Hibernate runs with ddl-auto=validate, so this file
-- must match the JPA entities exactly.

-- One deposit / withdrawal / transfer
CREATE TABLE transactions (
    id                     UUID           PRIMARY KEY,
    reference              VARCHAR(32)    NOT NULL,
    transaction_type       VARCHAR(20)    NOT NULL,
    status                 VARCHAR(20)    NOT NULL,
    source_account_id      VARCHAR(64),
    destination_account_id VARCHAR(64),
    amount                 NUMERIC(19, 2) NOT NULL,
    currency               VARCHAR(3)     NOT NULL,
    description            VARCHAR(255),
    initiated_by           VARCHAR(64)    NOT NULL,
    idempotency_key        VARCHAR(100),
    client_country         VARCHAR(8),
    correlation_id         VARCHAR(64)    NOT NULL,
    failure_reason         VARCHAR(500),
    failure_code           VARCHAR(50),
    risk_score             INTEGER,
    created_at             TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    updated_at             TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    completed_at           TIMESTAMP(6) WITH TIME ZONE,
    version                BIGINT,
    CONSTRAINT uk_transactions_reference UNIQUE (reference),
    CONSTRAINT ck_transactions_type CHECK (transaction_type IN ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER')),
    CONSTRAINT ck_transactions_status CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'PROCESSING', 'COMPLETED', 'FAILED')),
    CONSTRAINT ck_transactions_amount CHECK (amount > 0)
);

-- Idempotency-Key: one transaction per (user, key). NULL keys are not constrained.
CREATE UNIQUE INDEX uk_transactions_idempotency ON transactions (initiated_by, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_transactions_initiated_by ON transactions (initiated_by, created_at DESC);
CREATE INDEX idx_transactions_source ON transactions (source_account_id);
CREATE INDEX idx_transactions_destination ON transactions (destination_account_id);
CREATE INDEX idx_transactions_status ON transactions (status);

-- Every status change of a transaction
CREATE TABLE transaction_status_history (
    id             BIGSERIAL    PRIMARY KEY,
    transaction_id UUID         NOT NULL REFERENCES transactions (id),
    from_status    VARCHAR(20),
    to_status      VARCHAR(20)  NOT NULL,
    reason         VARCHAR(500),
    changed_at     TIMESTAMP(6) WITH TIME ZONE NOT NULL
);
CREATE INDEX idx_status_history_transaction ON transaction_status_history (transaction_id, changed_at);

-- Local audit trail (who/what did what to a transaction)
CREATE TABLE transaction_audit (
    id             BIGSERIAL     PRIMARY KEY,
    transaction_id UUID          NOT NULL REFERENCES transactions (id),
    action         VARCHAR(50)   NOT NULL,
    actor          VARCHAR(64)   NOT NULL,
    details        VARCHAR(1000),
    created_at     TIMESTAMP(6) WITH TIME ZONE NOT NULL
);
CREATE INDEX idx_transaction_audit_transaction ON transaction_audit (transaction_id, created_at);

-- Saga progress, one row per transaction
CREATE TABLE saga_states (
    id             UUID         PRIMARY KEY,
    transaction_id UUID         NOT NULL REFERENCES transactions (id),
    status         VARCHAR(30)  NOT NULL,
    current_step   VARCHAR(30)  NOT NULL,
    retry_count    INTEGER      NOT NULL DEFAULT 0,
    failure_reason VARCHAR(500),
    started_at     TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    updated_at     TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    completed_at   TIMESTAMP(6) WITH TIME ZONE,
    version        BIGINT,
    CONSTRAINT uk_saga_states_transaction UNIQUE (transaction_id)
);
-- used by the saga-timeout job
CREATE INDEX idx_saga_states_status_updated ON saga_states (status, updated_at);

-- Transactional outbox: events waiting to be published to Kafka
CREATE TABLE outbox_events (
    id             UUID          PRIMARY KEY,
    aggregate_type VARCHAR(50)   NOT NULL,
    aggregate_id   VARCHAR(64)   NOT NULL,
    event_type     VARCHAR(50)   NOT NULL,
    topic          VARCHAR(100)  NOT NULL,
    payload        TEXT          NOT NULL,
    status         VARCHAR(20)   NOT NULL,
    attempts       INTEGER       NOT NULL DEFAULT 0,
    last_error     VARCHAR(1000),
    created_at     TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    published_at   TIMESTAMP(6) WITH TIME ZONE
);
CREATE INDEX idx_outbox_events_status_created ON outbox_events (status, created_at);

-- Kafka events already handled (consumer de-duplication)
CREATE TABLE processed_events (
    event_id     VARCHAR(64)  PRIMARY KEY,
    event_type   VARCHAR(50)  NOT NULL,
    processed_at TIMESTAMP(6) WITH TIME ZONE NOT NULL
);

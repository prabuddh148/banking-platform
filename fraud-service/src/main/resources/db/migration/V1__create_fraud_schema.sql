-- fraud-service schema (database: fraud_db)

-- One row per checked transaction. The UNIQUE transaction_id makes event processing idempotent.
CREATE TABLE fraud_decisions (
    id               UUID PRIMARY KEY,
    transaction_id   VARCHAR(64)    NOT NULL UNIQUE,
    account_id       VARCHAR(64),
    transaction_type VARCHAR(20),
    amount           NUMERIC(19, 2) NOT NULL,
    currency         VARCHAR(3),
    initiated_by     VARCHAR(64),
    client_country   VARCHAR(8),
    risk_score       INTEGER        NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
    risk_level       VARCHAR(20)    NOT NULL,
    decision         VARCHAR(20)    NOT NULL,
    triggered_rules  TEXT,
    reason           TEXT,
    correlation_id   VARCHAR(64),
    reviewed_by      VARCHAR(64),
    evaluated_at     TIMESTAMPTZ    NOT NULL
);

-- Velocity and pattern rules look up recent decisions per account.
CREATE INDEX idx_fraud_decisions_account_time ON fraud_decisions (account_id, evaluated_at DESC);
CREATE INDEX idx_fraud_decisions_risk_level ON fraud_decisions (risk_level);

-- Suspicious transactions waiting for (or done with) an admin review.
CREATE TABLE fraud_alerts (
    id              UUID PRIMARY KEY,
    transaction_id  VARCHAR(64)    NOT NULL UNIQUE,
    account_id      VARCHAR(64),
    amount          NUMERIC(19, 2) NOT NULL,
    currency        VARCHAR(3),
    risk_score      INTEGER        NOT NULL,
    risk_level      VARCHAR(20)    NOT NULL,
    triggered_rules TEXT,
    status          VARCHAR(20)    NOT NULL,
    reason          TEXT,
    reviewed_by     VARCHAR(64),
    review_notes    TEXT,
    created_at      TIMESTAMPTZ    NOT NULL,
    reviewed_at     TIMESTAMPTZ,
    version         BIGINT
);

CREATE INDEX idx_fraud_alerts_status ON fraud_alerts (status, created_at DESC);
CREATE INDEX idx_fraud_alerts_risk_level ON fraud_alerts (risk_level);

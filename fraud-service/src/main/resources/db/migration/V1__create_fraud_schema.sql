-- Create fraud schema
CREATE SCHEMA IF NOT EXISTS fraud;

-- Create fraud_alerts table
CREATE TABLE IF NOT EXISTS fraud.fraud_alerts (
    id              UUID            NOT NULL DEFAULT gen_random_uuid(),
    transaction_id  UUID            NOT NULL,
    account_id      UUID            NOT NULL,
    risk_score      NUMERIC(5, 2),
    risk_level      VARCHAR(20),
    triggered_rules JSONB,
    decision        VARCHAR(20),
    reviewed_by     UUID,
    review_notes    TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    reviewed_at     TIMESTAMPTZ,

    CONSTRAINT pk_fraud_alerts PRIMARY KEY (id)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_transaction_id
    ON fraud.fraud_alerts (transaction_id);

CREATE INDEX IF NOT EXISTS idx_fraud_alerts_account_id
    ON fraud.fraud_alerts (account_id);

CREATE INDEX IF NOT EXISTS idx_fraud_alerts_risk_level
    ON fraud.fraud_alerts (risk_level);

CREATE INDEX IF NOT EXISTS idx_fraud_alerts_decision
    ON fraud.fraud_alerts (decision);

CREATE INDEX IF NOT EXISTS idx_fraud_alerts_created_at
    ON fraud.fraud_alerts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fraud_alerts_account_created
    ON fraud.fraud_alerts (account_id, created_at DESC);

COMMENT ON TABLE fraud.fraud_alerts IS 'Stores fraud detection analysis results for transactions';
COMMENT ON COLUMN fraud.fraud_alerts.transaction_id IS 'Reference to the transaction being evaluated';
COMMENT ON COLUMN fraud.fraud_alerts.account_id IS 'Source account involved in the transaction';
COMMENT ON COLUMN fraud.fraud_alerts.risk_score IS 'Calculated risk score between 0 and 100';
COMMENT ON COLUMN fraud.fraud_alerts.risk_level IS 'Risk category: LOW, MEDIUM, HIGH, CRITICAL';
COMMENT ON COLUMN fraud.fraud_alerts.triggered_rules IS 'JSON array of fraud rule names that were triggered';
COMMENT ON COLUMN fraud.fraud_alerts.decision IS 'Fraud decision: APPROVED, REJECTED, MANUAL_REVIEW';

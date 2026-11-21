-- =====================================================================
-- audit-service schema: one append-only table of audit log entries.
-- =====================================================================

CREATE TABLE audit_logs (
    id              UUID            PRIMARY KEY,
    event_id        VARCHAR(100)    NOT NULL,
    event_type      VARCHAR(50)     NOT NULL,
    raw_event_type  VARCHAR(100),
    aggregate_id    VARCHAR(100),
    aggregate_type  VARCHAR(30)     NOT NULL,
    actor           VARCHAR(100)    NOT NULL,
    action          VARCHAR(500)    NOT NULL,
    severity        VARCHAR(20)     NOT NULL,
    source_service  VARCHAR(100),
    correlation_id  VARCHAR(100),
    details         TEXT,
    occurred_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    recorded_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Each Kafka event is stored at most once (consumer idempotency).
    CONSTRAINT uk_audit_logs_event_id UNIQUE (event_id),
    CONSTRAINT ck_audit_logs_severity CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL'))
);

-- Indexes for the filters offered by GET /api/v1/audit/logs and the summary query.
CREATE INDEX idx_audit_logs_occurred_at       ON audit_logs (occurred_at DESC);
CREATE INDEX idx_audit_logs_aggregate         ON audit_logs (aggregate_id, occurred_at);
CREATE INDEX idx_audit_logs_actor             ON audit_logs (actor, occurred_at DESC);
CREATE INDEX idx_audit_logs_correlation       ON audit_logs (correlation_id, occurred_at);
CREATE INDEX idx_audit_logs_event_type        ON audit_logs (event_type, occurred_at DESC);
CREATE INDEX idx_audit_logs_severity          ON audit_logs (severity, occurred_at DESC);

-- ---------------------------------------------------------------------
-- Immutability: audit logs may only be INSERTed, never changed or removed.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_no_update_delete
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION reject_audit_log_modification();

CREATE TRIGGER trg_audit_logs_no_truncate
    BEFORE TRUNCATE ON audit_logs
    FOR EACH STATEMENT
    EXECUTE FUNCTION reject_audit_log_modification();

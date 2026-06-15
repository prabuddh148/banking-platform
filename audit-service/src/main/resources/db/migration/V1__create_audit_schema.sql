CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE audit.audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      VARCHAR(100)                NOT NULL,
    severity        VARCHAR(20)                 NOT NULL DEFAULT 'INFO',
    actor_id        UUID,
    actor_type      VARCHAR(50),
    resource_type   VARCHAR(100),
    resource_id     UUID,
    action          VARCHAR(50),
    description     VARCHAR(1000),
    old_value       JSONB,
    new_value       JSONB,
    metadata        JSONB,
    source_service  VARCHAR(100),
    correlation_id  VARCHAR(255),
    ip_address      VARCHAR(50),
    user_agent      VARCHAR(500),
    occurred_at     TIMESTAMP WITH TIME ZONE    NOT NULL,
    recorded_at     TIMESTAMP WITH TIME ZONE    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_resource        ON audit.audit_logs (resource_id);
CREATE INDEX idx_audit_logs_actor           ON audit.audit_logs (actor_id);
CREATE INDEX idx_audit_logs_occurred        ON audit.audit_logs (occurred_at DESC);
CREATE INDEX idx_audit_logs_event_type      ON audit.audit_logs (event_type);
CREATE INDEX idx_audit_logs_severity        ON audit.audit_logs (severity);
CREATE INDEX idx_audit_logs_source_service  ON audit.audit_logs (source_service);
CREATE INDEX idx_audit_logs_correlation_id  ON audit.audit_logs (correlation_id);

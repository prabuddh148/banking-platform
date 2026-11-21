-- notification-service schema (database: notifications_db)

-- One row per message per channel (EMAIL / SMS / PUSH).
CREATE TABLE notifications (
    id                UUID PRIMARY KEY,
    recipient_id      VARCHAR(64)   NOT NULL,
    channel           VARCHAR(16)   NOT NULL,
    type              VARCHAR(40)   NOT NULL,
    status            VARCHAR(16)   NOT NULL,
    recipient_address VARCHAR(255),
    subject           VARCHAR(255),
    message           TEXT,
    html_body         TEXT,
    reference_id      VARCHAR(64),
    event_id          VARCHAR(64),
    attempts          INTEGER       NOT NULL DEFAULT 0,
    error_message     VARCHAR(1000),
    created_at        TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at        TIMESTAMP WITH TIME ZONE NOT NULL,
    last_attempt_at   TIMESTAMP WITH TIME ZONE,
    sent_at           TIMESTAMP WITH TIME ZONE,
    read_at           TIMESTAMP WITH TIME ZONE,
    CONSTRAINT chk_notifications_channel CHECK (channel IN ('EMAIL', 'SMS', 'PUSH')),
    CONSTRAINT chk_notifications_status CHECK (status IN ('PENDING', 'SENT', 'FAILED'))
);

-- "My notifications, newest first"
CREATE INDEX idx_notifications_recipient_created ON notifications (recipient_id, created_at DESC);
-- Retry job: FAILED rows with attempts left
CREATE INDEX idx_notifications_status_attempts ON notifications (status, attempts);
CREATE INDEX idx_notifications_reference ON notifications (reference_id);

-- Who owns which account and how to reach them (filled from ACCOUNT_CREATED / ACCOUNT_STATUS_CHANGED).
CREATE TABLE account_contacts (
    account_id     VARCHAR(64) PRIMARY KEY,
    account_number VARCHAR(32),
    customer_id    VARCHAR(64)  NOT NULL,
    customer_name  VARCHAR(200),
    email          VARCHAR(255),
    phone          VARCHAR(32),
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at     TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_account_contacts_customer ON account_contacts (customer_id);

-- Kafka consumer idempotency: an event id is handled only once.
CREATE TABLE processed_events (
    event_id     VARCHAR(64) PRIMARY KEY,
    event_type   VARCHAR(64) NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE NOT NULL
);

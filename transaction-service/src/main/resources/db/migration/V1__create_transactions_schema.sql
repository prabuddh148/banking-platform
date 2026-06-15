-- Create schema
CREATE SCHEMA IF NOT EXISTS transactions;

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_number VARCHAR(50) NOT NULL UNIQUE,
    transaction_type VARCHAR(20) NOT NULL,
    source_account_id UUID,
    target_account_id UUID,
    amount NUMERIC(19, 4) NOT NULL,
    currency VARCHAR(3),
    status VARCHAR(20) NOT NULL,
    description TEXT,
    metadata JSONB,
    initiated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    version BIGINT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_transactions_reference_number ON transactions.transactions(reference_number);
CREATE INDEX IF NOT EXISTS idx_transactions_source_account_id ON transactions.transactions(source_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_target_account_id ON transactions.transactions(target_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions.transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_initiated_at ON transactions.transactions(initiated_at);

-- Create transaction_audit table
CREATE TABLE IF NOT EXISTS transactions.transaction_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL,
    event_type VARCHAR(100),
    actor VARCHAR(255),
    payload JSONB,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_audit_transaction_id ON transactions.transaction_audit(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_audit_recorded_at ON transactions.transaction_audit(recorded_at);

-- Create transaction_status_history table
CREATE TABLE IF NOT EXISTS transactions.transaction_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL,
    previous_status VARCHAR(20),
    new_status VARCHAR(20),
    reason TEXT,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_status_history_transaction_id ON transactions.transaction_status_history(transaction_id);

-- Create saga_state table
CREATE TABLE IF NOT EXISTS transactions.saga_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL UNIQUE,
    current_step VARCHAR(100),
    saga_status VARCHAR(20),
    step_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saga_state_transaction_id ON transactions.saga_state(transaction_id);
CREATE INDEX IF NOT EXISTS idx_saga_state_saga_status ON transactions.saga_state(saga_status);

-- Create outbox_events table
CREATE TABLE IF NOT EXISTS transactions.outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(100),
    aggregate_id UUID,
    event_type VARCHAR(100),
    payload JSONB,
    topic VARCHAR(255),
    partition_key VARCHAR(255),
    status VARCHAR(20) DEFAULT 'PENDING',
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    published_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_status ON transactions.outbox_events(status);
CREATE INDEX IF NOT EXISTS idx_outbox_events_created_at ON transactions.outbox_events(created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_events_aggregate_id ON transactions.outbox_events(aggregate_id);

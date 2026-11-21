// Facts shown on the "How it works" page. Source of truth: the repo README
// (sections 2, 9, 10, 11, 12, 14, 16, 21). Keep them in sync when the backend changes.

export const GITHUB_URL = 'https://github.com/prabuddh148/banking-platform'

export const TOPICS = [
  {
    id: 'account',
    name: 'banking.account.events',
    producer: 'account',
    consumers: ['transaction', 'notification', 'audit'],
    events: ['ACCOUNT_CREATED', 'ACCOUNT_STATUS_CHANGED', 'BALANCE_UPDATED', 'BALANCE_UPDATE_FAILED'],
    retention: '7 days',
  },
  {
    id: 'transaction',
    name: 'banking.transaction.events',
    producer: 'transaction',
    consumers: ['account', 'fraud', 'notification', 'audit'],
    events: ['TRANSACTION_INITIATED', 'BALANCE_UPDATE_REQUESTED', 'TRANSACTION_COMPLETED', 'TRANSACTION_FAILED'],
    retention: '7 days',
  },
  {
    id: 'fraud',
    name: 'banking.fraud.events',
    producer: 'fraud',
    consumers: ['transaction', 'audit'],
    events: ['FRAUD_CLEARED', 'FRAUD_DETECTED'],
    retention: '7 days',
  },
  {
    id: 'notification',
    name: 'banking.notification.events',
    producer: 'any service',
    consumers: ['notification'],
    events: ['NOTIFICATION_REQUESTED'],
    retention: '3 days',
  },
]

export const SERVICES = [
  {
    id: 'account',
    name: 'account-service',
    short: 'Accounts',
    port: 8081,
    db: 'accounts_db',
    responsibility: 'Owns accounts, status, balances and holds. Applies the debit and credit for every saga, atomically.',
    tables: ['accounts', 'account_balances', 'balance_reservations', 'account_status_history', 'processed_transactions', 'outbox_events'],
    publishes: { topic: 'account', events: ['ACCOUNT_CREATED', 'ACCOUNT_STATUS_CHANGED', 'BALANCE_UPDATED', 'BALANCE_UPDATE_FAILED'], via: 'outbox' },
    consumes: [{ topic: 'transaction', events: ['BALANCE_UPDATE_REQUESTED'] }],
    classes: ['AccountBalanceServiceImpl', 'TransactionCompletedConsumer', 'OutboxEventRelay', 'AccountBalanceRepository'],
    patterns: ['Pessimistic row locks (SELECT … FOR UPDATE, ordered by id)', 'Transactional outbox + FOR UPDATE SKIP LOCKED', 'Idempotent via processed_transactions'],
    tests: 34,
  },
  {
    id: 'transaction',
    name: 'transaction-service',
    short: 'Transactions',
    port: 8082,
    db: 'transactions_db',
    responsibility: 'Deposit, withdraw and transfer API (202 Accepted) and the saga orchestrator, including saga timeouts.',
    tables: ['transactions', 'saga_states', 'transaction_status_history', 'transaction_audit', 'outbox_events', 'processed_events'],
    publishes: { topic: 'transaction', events: ['TRANSACTION_INITIATED', 'BALANCE_UPDATE_REQUESTED', 'TRANSACTION_COMPLETED', 'TRANSACTION_FAILED'], via: 'outbox' },
    consumes: [
      { topic: 'fraud', events: ['FRAUD_CLEARED', 'FRAUD_DETECTED'] },
      { topic: 'account', events: ['BALANCE_UPDATED', 'BALANCE_UPDATE_FAILED'] },
    ],
    classes: ['TransactionSagaOrchestrator', 'FraudDecisionConsumer', 'AccountResponseConsumer', 'TransactionEventProducer'],
    patterns: ['Orchestrated saga with timeouts', 'Idempotency-Key header (unique per user)', 'processed_events + state checks'],
    tests: 33,
  },
  {
    id: 'fraud',
    name: 'fraud-service',
    short: 'Fraud',
    port: 8083,
    db: 'fraud_db',
    responsibility: 'Scores every transaction with a rule engine and queues risky ones for an admin to review.',
    tables: ['fraud_decisions', 'fraud_alerts'],
    publishes: { topic: 'fraud', events: ['FRAUD_CLEARED', 'FRAUD_DETECTED'], via: 'direct' },
    consumes: [{ topic: 'transaction', events: ['TRANSACTION_INITIATED'] }],
    classes: ['RuleEngineService', 'AmountThresholdRule', 'VelocityRule', 'GeographicRule', 'PatternAnomalyRule', 'RiskScoreCalculator'],
    patterns: ['Strategy pattern: every rule is a FraudRule bean', 'Human-in-the-loop review queue', 'UNIQUE transaction_id = idempotent'],
    tests: 36,
  },
  {
    id: 'notification',
    name: 'notification-service',
    short: 'Notifications',
    port: 8084,
    db: 'notifications_db',
    responsibility: 'Sends email (SMTP + Thymeleaf templates) and simulated SMS/push for account and transaction events, with retries.',
    tables: ['notifications', 'account_contacts', 'processed_events'],
    publishes: null,
    consumes: [
      { topic: 'account', events: ['ACCOUNT_CREATED', 'ACCOUNT_STATUS_CHANGED'] },
      { topic: 'transaction', events: ['TRANSACTION_COMPLETED', 'TRANSACTION_FAILED'] },
      { topic: 'notification', events: ['NOTIFICATION_REQUESTED'] },
    ],
    classes: ['NotificationServiceImpl', 'EmailNotificationService', 'EmailTemplateResolver', 'TransactionEventConsumer'],
    patterns: ['Retry job (every 60 s, max 3 attempts)', 'Local contact copy from events', 'Delivery errors never break the consumer'],
    tests: 32,
  },
  {
    id: 'audit',
    name: 'audit-service',
    short: 'Audit',
    port: 8085,
    db: 'audit_db',
    responsibility: 'Keeps an append-only audit trail of every account, transaction and fraud event, with PII masked.',
    tables: ['audit_logs'],
    publishes: null,
    consumes: [
      { topic: 'account', events: ['all account events'] },
      { topic: 'transaction', events: ['all transaction events'] },
      { topic: 'fraud', events: ['all fraud events'] },
    ],
    classes: ['AuditServiceImpl', 'AuditLogFormatter', 'AuditLogRepository', 'FraudEventConsumer'],
    patterns: ['DB triggers reject UPDATE / DELETE / TRUNCATE', 'UNIQUE event_id = idempotent', 'Severity derived from event type'],
    tests: 35,
  },
]

export const EDGE_NODES = {
  browser: {
    id: 'browser',
    name: 'React frontend',
    short: 'Browser',
    port: 5173,
    responsibility: 'Customer app and operations console (React 18, Vite, Tailwind). Talks only to the gateway, with a Bearer JWT on every call.',
    facts: [
      ['Stack', 'React 18 · Vite 5 · Tailwind 3 · react-router 6'],
      ['Auth', 'JWT in memory/session, attached as Authorization header'],
      ['Writes', 'Idempotency-Key + X-Client-Country headers on transfers'],
      ['Demo', 'This build runs in mock mode, fully in the browser'],
    ],
  },
  gateway: {
    id: 'gateway',
    name: 'api-gateway',
    short: 'Gateway',
    port: 8080,
    responsibility: 'The single entry point: issues JWTs at login, validates them on every request, routes to services and protects them with circuit breakers.',
    facts: [
      ['Runtime', 'Spring Cloud Gateway (WebFlux, reactive)'],
      ['Filters', 'TraceIdPropagation → RequestLogging → CORS → JwtAuthentication'],
      ['Headers', 'Strips client X-User-Id / X-User-Roles, sets them from the token'],
      ['Resilience', 'Resilience4j circuit breaker per route, /fallback → 503'],
      ['Tests', '17 (full app with WebTestClient)'],
    ],
  },
}

/* ------------------------------------------------------------- saga player */

const TXN_ID = '5d2b0c8e-3f4a-4c55-8e0e-1a2b3c4d5e6f'
const CORR = 'c0ffee00-1111-2222-3333-444455556666'
const RAHUL_ACC = 'acc-9a7c41d2'
const PRIYA_ACC = 'acc-4e1d77b0'

const base = (eventType, source, extra) => ({
  eventId: `evt-${eventType.toLowerCase().replace(/_/g, '-')}`,
  eventType,
  aggregateId: TXN_ID,
  occurredAt: '2026-11-21T10:15:30.123Z',
  correlationId: CORR,
  source,
  schemaVersion: 1,
  ...extra,
})

const txnCore = (amount, extra = {}) => ({
  transactionId: TXN_ID,
  reference: 'TXN20261121K7Q2M9XA',
  transactionType: 'TRANSFER',
  sourceAccountId: RAHUL_ACC,
  destinationAccountId: PRIYA_ACC,
  amount,
  currency: 'INR',
  initiatedBy: 'CUST-1001',
  ...extra,
})

// Actors (lanes) used by the player
export const ACTORS = [
  { id: 'client', label: 'Client' },
  { id: 'transaction', label: 'Transaction' },
  { id: 'kafka', label: 'Kafka' },
  { id: 'fraud', label: 'Fraud' },
  { id: 'account', label: 'Account' },
  { id: 'notification', label: 'Notify' },
  { id: 'audit', label: 'Audit' },
]

function stepsFor(scenario) {
  const amount = scenario === 'review' ? 150000 : scenario === 'insufficient' ? 90000 : 1500
  const country = scenario === 'review' ? 'US' : 'IN'
  const description = scenario === 'review' ? 'Car down payment' : scenario === 'insufficient' ? 'Laptop' : 'Rent share'

  const request = {
    kind: 'http',
    title: 'POST /api/v1/transactions/transfer',
    headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9…', 'Idempotency-Key': '7f3c2a10-transfer-0001', 'X-Client-Country': country },
    body: { sourceAccountId: RAHUL_ACC, destinationAccountId: PRIYA_ACC, amount, currency: 'INR', description },
  }

  const s1 = {
    from: 'client', to: 'transaction',
    title: 'Transfer requested',
    detail: 'The gateway validates the JWT and forwards the call. transaction-service validates the body, saves the transaction and an outbox row in one DB transaction, then answers 202 Accepted straight away.',
    txn: 'PENDING', saga: 'AWAITING_FRAUD_CHECK', step: 'FRAUD_CHECK',
    tables: ['transactions', 'saga_states', 'outbox_events'],
    payload: request,
  }
  const s2 = {
    from: 'transaction', to: 'kafka',
    title: 'Outbox relay publishes',
    detail: 'OutboxEventRelay polls every 2 s, sends PENDING rows with acks=all and marks them PUBLISHED. The DB change and the event can never get out of sync.',
    txn: 'PENDING', saga: 'AWAITING_FRAUD_CHECK', step: 'FRAUD_CHECK',
    topic: 'banking.transaction.events',
    tables: ['outbox_events'],
    payload: { kind: 'event', body: base('TRANSACTION_INITIATED', 'transaction-service', txnCore(amount, { description, clientCountry: country })) },
  }

  const rules = scenario === 'review'
    ? [{ rule: 'AmountThresholdRule', score: 40 }, { rule: 'GeographicRule', score: 25 }]
    : scenario === 'insufficient' ? [{ rule: 'PatternAnomalyRule', score: 20 }] : []
  const score = rules.reduce((s, r) => s + r.score, 0)

  const s3 = scenario === 'review'
    ? {
        from: 'kafka', to: 'fraud',
        title: 'Fraud engine: HIGH risk',
        detail: '₹1,50,000 (> ₹1,00,000: +40) from the US (not in the allowed list: +25) scores 65. That is HIGH, so an OPEN alert is created for a human to review.',
        txn: 'PENDING', saga: 'AWAITING_FRAUD_CHECK', step: 'FRAUD_CHECK',
        topic: 'banking.fraud.events',
        tables: ['fraud_decisions', 'fraud_alerts'],
        rules, score,
        payload: { kind: 'event', body: base('FRAUD_DETECTED', 'fraud-service', { transactionId: TXN_ID, riskScore: 65, riskLevel: 'HIGH', decision: 'REVIEW', triggeredRules: ['AMOUNT_THRESHOLD', 'GEOGRAPHIC'], reason: 'High value transfer from a non-allowed country', alertId: 'ALR-20431' }) },
      }
    : {
        from: 'kafka', to: 'fraud',
        title: `Fraud engine: ${score < 30 ? 'LOW' : 'MEDIUM'} risk`,
        detail: `Four rules run (amount, velocity, geography, pattern anomaly). Score ${score} is ${score < 30 ? 'LOW' : 'MEDIUM'}, so the decision is APPROVE and fraud-service publishes FRAUD_CLEARED.`,
        txn: 'PENDING', saga: 'AWAITING_FRAUD_CHECK', step: 'FRAUD_CHECK',
        topic: 'banking.fraud.events',
        tables: ['fraud_decisions'],
        rules, score,
        payload: { kind: 'event', body: base('FRAUD_CLEARED', 'fraud-service', { transactionId: TXN_ID, riskScore: score, riskLevel: 'LOW', decision: 'APPROVE', triggeredRules: rules.map((r) => r.rule.replace('Rule', '').replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()), reason: score ? `Low risk (score ${score} < 30)` : 'No rules triggered' }) },
      }

  const requestBalance = (extraDetail) => ({
    from: 'transaction', to: 'kafka',
    title: 'Balance update requested',
    detail: `${extraDetail} The orchestrator stores the risk score and writes BALANCE_UPDATE_REQUESTED to the outbox.`,
    txn: 'PROCESSING', saga: 'AWAITING_BALANCE_UPDATE', step: 'BALANCE_UPDATE',
    topic: 'banking.transaction.events',
    tables: ['transactions', 'saga_states', 'transaction_status_history', 'outbox_events'],
    payload: { kind: 'event', body: base('BALANCE_UPDATE_REQUESTED', 'transaction-service', txnCore(amount)) },
  })

  const debitCredit = {
    from: 'kafka', to: 'account',
    title: 'Atomic debit + credit',
    detail: 'account-service locks both balance rows (SELECT … FOR UPDATE, ordered by id to avoid deadlocks), checks status, currency, ownership and funds, then debits Rahul and credits Priya in one DB transaction.',
    txn: 'PROCESSING', saga: 'AWAITING_BALANCE_UPDATE', step: 'BALANCE_UPDATE',
    topic: 'banking.account.events',
    tables: ['account_balances', 'processed_transactions', 'outbox_events'],
    payload: { kind: 'event', body: base('BALANCE_UPDATED', 'account-service', { transactionId: TXN_ID, transactionType: 'TRANSFER', sourceAccountId: RAHUL_ACC, destinationAccountId: PRIYA_ACC, amount, currency: 'INR', sourceBalanceAfter: scenario === 'review' ? 98420.5 : 246920.5, destinationBalanceAfter: scenario === 'review' ? 211500 : 63000 }) },
  }

  const complete = {
    from: 'kafka', to: 'transaction',
    title: 'Transfer completed',
    detail: 'BALANCE_UPDATED closes the saga. The orchestrator marks the transaction COMPLETED and writes TRANSACTION_COMPLETED to the outbox.',
    txn: 'COMPLETED', saga: 'COMPLETED', step: 'COMPLETION',
    topic: 'banking.transaction.events',
    tables: ['transactions', 'saga_states', 'transaction_status_history', 'outbox_events'],
    payload: { kind: 'event', body: base('TRANSACTION_COMPLETED', 'transaction-service', txnCore(amount, { description, completedAt: '2026-11-21T10:15:34.870Z' })) },
  }

  const notify = (failed) => ({
    from: 'kafka', to: 'notification',
    title: failed ? 'Customer told why' : 'Both parties notified',
    detail: failed
      ? 'notification-service sends Rahul a TRANSACTION_FAILED email and SMS with the reason. Nothing was debited.'
      : 'notification-service emails and texts Rahul (TRANSACTION_COMPLETED) and sends Priya a MONEY_RECEIVED message. Account numbers are masked.',
    txn: failed ? 'FAILED' : 'COMPLETED', saga: failed ? 'FAILED' : 'COMPLETED', step: failed ? 'FAILED' : 'COMPLETION',
    tables: ['notifications'],
    payload: {
      kind: 'json',
      title: 'notifications (rows)',
      body: failed
        ? [{ recipientId: 'CUST-1001', channel: 'EMAIL', type: 'TRANSACTION_FAILED', status: 'SENT' }, { recipientId: 'CUST-1001', channel: 'SMS', type: 'TRANSACTION_FAILED', status: 'SENT' }]
        : [
            { recipientId: 'CUST-1001', channel: 'EMAIL', type: 'TRANSACTION_COMPLETED', status: 'SENT' },
            { recipientId: 'CUST-1001', channel: 'SMS', type: 'TRANSACTION_COMPLETED', status: 'SENT' },
            { recipientId: 'CUST-1002', channel: 'EMAIL', type: 'MONEY_RECEIVED', status: 'SENT' },
          ],
    },
  })

  const audit = (events, warning) => ({
    from: 'kafka', to: 'audit',
    title: 'Immutable audit trail',
    detail: `audit-service records every event of the flow (${events.length} rows, same correlationId). A database trigger rejects UPDATE, DELETE and TRUNCATE on audit_logs.`,
    txn: warning ? 'FAILED' : 'COMPLETED', saga: warning ? 'FAILED' : 'COMPLETED', step: warning ? 'FAILED' : 'COMPLETION',
    tables: ['audit_logs'],
    payload: {
      kind: 'json',
      title: 'audit_logs (rows)',
      body: events.map((e) => ({ eventType: e, actor: e.startsWith('FRAUD_CLEARED') && scenario === 'review' ? 'admin' : 'CUST-1001', severity: e === warning ? 'WARNING' : e === 'FRAUD_DETECTED' ? 'WARNING' : 'INFO', correlationId: CORR })),
    },
  })

  if (scenario === 'review') {
    return [
      s1, s2, s3,
      {
        from: 'kafka', to: 'transaction',
        title: 'Parked for manual review',
        detail: 'FRAUD_DETECTED with decision REVIEW puts the transaction UNDER_REVIEW. This state never times out: it waits for a person.',
        txn: 'UNDER_REVIEW', saga: 'AWAITING_REVIEW', step: 'MANUAL_REVIEW',
        tables: ['transactions', 'saga_states', 'transaction_status_history'],
        payload: { kind: 'json', title: 'GET /api/v1/transactions/{id}/saga', body: { sagaId: 'saga-81f2', transactionId: TXN_ID, status: 'AWAITING_REVIEW', currentStep: 'MANUAL_REVIEW', retryCount: 0 } },
      },
      {
        from: 'client', to: 'fraud',
        title: 'Admin approves the alert',
        detail: 'An admin reviews alert ALR-20431 in the operations console and approves it. fraud-service publishes FRAUD_CLEARED with reviewedBy = admin.',
        txn: 'UNDER_REVIEW', saga: 'AWAITING_REVIEW', step: 'MANUAL_REVIEW',
        topic: 'banking.fraud.events',
        tables: ['fraud_alerts', 'fraud_decisions'],
        payload: { kind: 'http', title: 'POST /api/v1/fraud/alerts/ALR-20431/review', headers: { Authorization: 'Bearer <admin jwt>' }, body: { decision: 'APPROVE', notes: 'Customer confirmed by phone' } },
      },
      requestBalance('FRAUD_CLEARED arrives (reviewedBy admin).'),
      debitCredit,
      complete,
      notify(false),
      audit(['TRANSACTION_INITIATED', 'FRAUD_DETECTED', 'FRAUD_CLEARED', 'BALANCE_UPDATE_REQUESTED', 'BALANCE_UPDATED', 'TRANSACTION_COMPLETED']),
    ]
  }

  if (scenario === 'insufficient') {
    return [
      s1, s2, s3,
      requestBalance('FRAUD_CLEARED arrives.'),
      {
        from: 'kafka', to: 'account',
        title: 'Insufficient funds',
        detail: 'Rahul has ₹12,400 available, less than ₹90,000. Nothing changes, both locks are released and BALANCE_UPDATE_FAILED goes out through the outbox. No compensation needed: a half-done transfer cannot exist.',
        txn: 'PROCESSING', saga: 'AWAITING_BALANCE_UPDATE', step: 'BALANCE_UPDATE',
        topic: 'banking.account.events',
        tables: ['processed_transactions', 'outbox_events'],
        payload: { kind: 'event', body: base('BALANCE_UPDATE_FAILED', 'account-service', { transactionId: TXN_ID, reason: 'Available balance 12400.00 is less than 90000.00', errorCode: 'INSUFFICIENT_FUNDS' }) },
      },
      {
        from: 'kafka', to: 'transaction',
        title: 'Saga fails cleanly',
        detail: 'The orchestrator marks the transaction FAILED with the error code and writes TRANSACTION_FAILED to the outbox.',
        txn: 'FAILED', saga: 'FAILED', step: 'FAILED',
        topic: 'banking.transaction.events',
        tables: ['transactions', 'saga_states', 'transaction_status_history', 'outbox_events'],
        payload: { kind: 'event', body: base('TRANSACTION_FAILED', 'transaction-service', txnCore(amount, { failureReason: 'Insufficient funds', failureCode: 'INSUFFICIENT_FUNDS' })) },
      },
      notify(true),
      audit(['TRANSACTION_INITIATED', 'FRAUD_CLEARED', 'BALANCE_UPDATE_REQUESTED', 'BALANCE_UPDATE_FAILED', 'TRANSACTION_FAILED'], 'BALANCE_UPDATE_FAILED'),
    ]
  }

  return [
    s1, s2, s3,
    requestBalance('FRAUD_CLEARED arrives.'),
    debitCredit,
    complete,
    notify(false),
    audit(['TRANSACTION_INITIATED', 'FRAUD_CLEARED', 'BALANCE_UPDATE_REQUESTED', 'BALANCE_UPDATED', 'TRANSACTION_COMPLETED']),
  ]
}

export const SCENARIOS = [
  { value: 'happy', label: 'Happy path', blurb: 'Rahul sends Priya ₹1,500 for rent.', amount: 1500 },
  { value: 'review', label: 'Fraud review', blurb: 'Rahul sends ₹1,50,000 from the US: flagged for review.', amount: 150000 },
  { value: 'insufficient', label: 'Insufficient funds', blurb: 'Rahul tries to send ₹90,000 with ₹12,400 available.', amount: 90000 },
]

export const SAGA_STEPS = Object.fromEntries(SCENARIOS.map((s) => [s.value, stepsFor(s.value)]))

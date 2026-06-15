# ADR-0006: Async Fraud Detection via Kafka Saga

**Status**: Accepted

**Date**: 2024-02-01

**Deciders**: Platform Architecture Team, Backend Engineering Lead, Security/Fraud Team Lead

---

## Context

The Banking Platform's core `transfer` operation requires a fraud check before money can move between accounts. The `transaction-service` orchestrates this flow via a saga pattern (see ADR-0002). The team needed to decide how the fraud check integrates with the transaction saga.

The `fraud-service` (port 8083) runs a rule-based fraud detection engine that evaluates transaction velocity, amount thresholds, behavioral patterns, and blocklisted accounts. At peak load, fraud evaluation can take up to 2 seconds for complex rule sets. Fraud-service also needs to be independently deployable: the fraud team iterates on detection rules frequently without coordinating with the transaction team.

Two architecturally distinct options were evaluated.

**Option A** — Synchronous REST call from `transaction-service` to `fraud-service` during the saga. The saga step calls `GET /api/v1/fraud/evaluate` and blocks until it receives APPROVE or REJECT.

**Option B** — Asynchronous Kafka event. The saga publishes a `transaction.initiated` event; `fraud-service` consumes it, evaluates, and publishes a `fraud.decision` event; the saga resumes on receipt of the decision event.

The decision must consider: service coupling, thread utilization, operational blast radius, audit requirements, and timeout handling.

---

## Decision

We will use **async fraud detection via Kafka** (Option B). The transaction orchestration saga uses the following event flow for the fraud check step:

### Event Flow

```
transaction-service (Saga Orchestrator)
  │
  │  1. Publish: transaction.initiated
  │     Payload: {transactionId, fromAccountId, toAccountId, amount, currency, userId}
  │
  ▼
Kafka Topic: transaction.initiated
  │
  ▼
fraud-service (Consumer)
  │  2. Consume event
  │  3. Run fraud rule engine (velocity checks, amount limits, blocklist)
  │  4. Persist decision to fraud_db (audit trail)
  │
  │  5. Publish: fraud.decision
  │     Payload: {transactionId, decision: APPROVED|REJECTED, reason, rulesFired[], evaluationMs}
  │
  ▼
Kafka Topic: fraud.decision
  │
  ▼
transaction-service (Saga Orchestrator)
  │  6. Consume fraud.decision
  │  7. Correlate by transactionId to waiting saga instance
  │  8. Resume saga:
  │     APPROVED → proceed to debit/credit steps
  │     REJECTED → compensate, update transaction status to FRAUD_REJECTED
```

### Saga State Machine for Fraud Check Step

```
INITIATED
    │
    ▼
FRAUD_CHECK_PENDING ──(30s timeout)──► FRAUD_CHECK_TIMEOUT → COMPENSATING → FAILED
    │
    ├──(fraud.decision: APPROVED)──► DEBIT_PENDING → ...
    │
    └──(fraud.decision: REJECTED)──► FRAUD_REJECTED (terminal)
```

### Timeout Handling

If `fraud.decision` is not received within **30 seconds**, the saga automatically compensates and fails the transaction with status `FAILED` and reason `FRAUD_CHECK_TIMEOUT`. The timeout is implemented via a scheduled check on the `saga_state` table in `transaction_db`.

The 30-second threshold was chosen based on:
- Fraud rule engine p99 evaluation time: ~2 seconds
- Kafka round-trip overhead: ~50ms
- Buffer for consumer group rebalance events: ~10 seconds
- Customer UX tolerance for transfer completion: 30 seconds maximum

### Kafka Topic Configuration

| Topic | Partitions | Replication Factor | Retention |
|---|---|---|---|
| `transaction.initiated` | 12 | 3 (prod) / 1 (dev) | 7 days |
| `fraud.decision` | 12 | 3 (prod) / 1 (dev) | 30 days |

`fraud.decision` has longer retention (30 days) to support fraud auditing and retrospective analysis of decision patterns.

### Consumer Group Configuration

| Service | Topic Consumed | Consumer Group | Processing Guarantee |
|---|---|---|---|
| fraud-service | `transaction.initiated` | `fraud-service-cg` | At-least-once (idempotent via transactionId) |
| transaction-service | `fraud.decision` | `transaction-saga-cg` | At-least-once (idempotent via saga state check) |

---

## Consequences

### Positive

- **Decoupled services**: `transaction-service` and `fraud-service` are decoupled at both compile time and runtime. The fraud team can deploy new rule engine versions, scale `fraud-service` independently, or even take `fraud-service` offline for maintenance (transactions will accumulate in `transaction.initiated` and be processed when the service restarts). Neither team needs to coordinate deployments.

- **No thread blocking in transaction-service**: The saga publishes the event and releases the thread. No HTTP thread pool in `transaction-service` is held waiting for fraud evaluation. Under a fraud-service slowdown scenario, `transaction-service` threads are free to process other saga steps. Thread utilization is decoupled from fraud evaluation latency.

- **Durable audit trail**: Every `fraud.decision` event is persisted in the Kafka log for 30 days and written to `fraud_db` permanently. The fraud team can run retrospective analysis on decision patterns, false positive rates, and rule effectiveness without querying the transaction saga state. The event log is the ground truth.

- **Independent scalability**: During high-volume periods, `fraud-service` can be scaled out (more consumer instances, more partitions) without any changes to `transaction-service`. Kafka consumer group rebalancing handles the distribution automatically.

- **Additional fraud consumers at zero cost**: New consumers of `transaction.initiated` can be added (e.g., a real-time fraud analytics dashboard, a machine learning feature pipeline) without any changes to `transaction-service`. The producer is unaware of consumers.

- **Resilience via consumer lag**: A brief `fraud-service` outage results in consumer lag (events accumulate in Kafka) rather than `transaction-service` errors. When `fraud-service` restarts, it processes the backlog. Transactions that exceed the 30-second timeout fail gracefully with `FRAUD_CHECK_TIMEOUT`.

### Negative

- **Higher end-to-end latency for transfer completion**: A synchronous REST call would complete the fraud check in 2-5 seconds under normal conditions. The async Kafka round-trip adds event publishing latency, consumer processing latency, and saga resumption latency. Measured total async latency: ~3-8 seconds under normal conditions versus ~2-3 seconds for synchronous REST. This is acceptable given the 30-second customer-facing SLA.

- **More complex saga state machine**: The async fraud check adds a `FRAUD_CHECK_PENDING` state with timeout handling, a separate compensation path for fraud rejection, and correlation logic to match `fraud.decision` events back to waiting saga instances by `transactionId`. This complexity is real and requires thorough testing.

- **Harder to debug**: A failed transfer may span events in `transaction-service`, `fraud-service`, and Kafka. Debugging requires distributed tracing (OpenTelemetry with `transactionId` as the trace correlation key) and cross-service log correlation. A purely synchronous flow would have a single stack trace.

- **Timeout handling complexity**: The 30-second saga timeout must be implemented as a separate scheduled mechanism (a `ScheduledExecutorService` or a Spring `@Scheduled` task that polls `saga_state` for stale `FRAUD_CHECK_PENDING` sagas). This adds code that must be tested and monitored independently.

- **At-least-once delivery requires idempotency**: Both `fraud-service` (consuming `transaction.initiated`) and `transaction-service` (consuming `fraud.decision`) must be idempotent. Duplicate delivery must not result in double evaluation or double saga resumption. Idempotency is implemented via database unique constraints on `transactionId` in both services.

### Neutral

- The `transactionId` (ULID) is the correlation key that links events across topics. It must be present in all events in the transaction saga. This is a design constraint that all future saga steps must respect.

---

## Alternatives Considered

### Alternative A: Synchronous REST Call from transaction-service to fraud-service

`transaction-service` calls `GET /api/v1/internal/fraud/evaluate` on `fraud-service` via HTTP during the saga. The saga blocks until receiving a 200 (APPROVED) or 422 (REJECTED) response.

**Rejected because**:

- **Tight runtime coupling**: `fraud-service` must be healthy and responsive for every transfer to succeed. Any `fraud-service` deployment, slowdown, or outage immediately causes `transaction-service` API errors. The two services cannot be independently operated.

- **Thread blocking**: HTTP calls block `transaction-service` thread pool workers for the duration of the fraud evaluation (up to 2 seconds). Under load, this exhausts the thread pool and causes cascading failures in `transaction-service` that affect other API operations (balance checks, transfer history) unrelated to fraud.

- **No audit trail in event stream**: Fraud decisions are returned inline in the HTTP response and stored only in `fraud_db`. The `fraud.decision` Kafka topic — and its audit, replay, and analytics value — does not exist.

- **Scaling friction**: Scaling `fraud-service` for load requires `transaction-service` to be load-balanced across the new instances, requiring service discovery configuration changes.

- **Not rejected for all contexts**: For a future "fraud pre-check" (a lightweight check before initiating the full saga, e.g., checking the destination account against a blocklist), a synchronous REST call may be appropriate. That would be a separate, lighter-weight check and would be captured in a new ADR.

---

## Observability Requirements

Given the async nature of this flow, the following observability instrumentation is required:

| Signal | Implementation | Alert Threshold |
|---|---|---|
| `fraud_check_pending_duration_ms` histogram | OpenTelemetry in `transaction-service` saga | Alert if p95 > 10s |
| `fraud_decision_consumer_lag` | Kafka consumer group lag metric | Alert if lag > 1000 messages |
| `fraud_check_timeout_total` counter | Incremented on `FRAUD_CHECK_TIMEOUT` compensation | Alert if > 5/min |
| `fraud_decision_rate` by decision type | Grafana dashboard panel | Informational; alert if REJECTED rate > 20% |
| Distributed trace correlation | OTel `transactionId` baggage propagation | Trace must span both services |

---

## References

- [ADR-0001](./0001-kafka-async-communication.md) — Kafka selection that enables this pattern
- [ADR-0002](./0002-orchestration-saga.md) — Orchestration saga that contains the fraud check step
- [ADR-0003](./0003-outbox-pattern.md) — Outbox pattern ensures `transaction.initiated` is published reliably
- [Chris Richardson — Saga Pattern](https://microservices.io/patterns/data/saga.html)
- Internal load test results: `docs/performance/2024-02-fraud-async-load-test.md`

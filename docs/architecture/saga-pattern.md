# Saga Pattern

## Table of Contents

1. [Why Saga](#why-saga)
2. [Orchestration vs Choreography](#orchestration-vs-choreography)
3. [The Saga Orchestrator](#the-saga-orchestrator)
4. [Saga State Machine](#saga-state-machine)
5. [Saga Steps Reference](#saga-steps-reference)
6. [Saga Persistence](#saga-persistence)
7. [Timeout Handling](#timeout-handling)
8. [Idempotency](#idempotency)
9. [Failure Scenarios](#failure-scenarios)
10. [Monitoring and Alerting](#monitoring-and-alerting)

---

## Why Saga

A money transfer in this platform touches two distinct services:

- **account-service** — owns account balances and must debit the sender and credit the receiver
- **transaction-service** — owns the transaction record and must reflect the final outcome

Both mutations must succeed or both must fail. There must be no state where the sender's balance is debited but the receiver's balance is not credited, or where a transaction record says COMPLETED but a balance was never moved.

### Why Not Two-Phase Commit (2PC)

The classical solution to distributed consistency is Two-Phase Commit. It is rejected here for the following reasons:

| Concern           | Impact on this Platform                                                                 |
|-------------------|-----------------------------------------------------------------------------------------|
| Blocking protocol | The prepare phase holds database locks across a network round-trip. Under any network partition, both participants block indefinitely. |
| Single coordinator failure | If the coordinator crashes after sending PREPARE but before sending COMMIT, participants remain locked until coordinator recovery. |
| Tight coupling    | 2PC requires both participants to implement the XA protocol and share a coordinator. This creates infrastructure coupling that conflicts with the microservices independence goal. |
| Kafka incompatibility | Kafka does not participate in XA transactions. We cannot atomically include a Kafka event publication in a 2PC transaction that spans two PostgreSQL databases. |

### Why Saga Works Here

A Saga breaks the distributed transaction into a sequence of local transactions, each with a compensating action that can undo its effect. If any step fails, the saga runs compensating actions in reverse order to restore consistency. The system reaches a consistent state in either the forward (happy) or backward (compensated) direction.

Key properties:
- No distributed locks are held between steps
- Each step is a local ACID transaction on a single database
- The platform is eventually consistent (not immediately consistent), which is acceptable for async transfer processing where the client receives 202 Accepted

---

## Orchestration vs Choreography

Two patterns exist for coordinating saga steps:

| Property                       | Choreography                                      | Orchestration                                        |
|--------------------------------|---------------------------------------------------|------------------------------------------------------|
| Control flow                   | Distributed across event-reacting services        | Centralised in a single orchestrator component       |
| Visibility                     | Implicit — must trace across multiple service logs| Explicit — one component holds the complete state    |
| Compensating action ownership  | Each service decides when to compensate           | Orchestrator explicitly triggers compensation        |
| Debugging failed sagas         | Hard — requires correlating events across services| Easy — query the SagaState table in transaction-service|
| Adding a new saga step         | Requires modifying event consumers in multiple services | Modify the orchestrator in one place             |

**Decision: Orchestration was chosen** for the following reasons:

1. **Centralised visibility:** The `saga_state` table in the `transactions` schema is a single source of truth for where any transfer is in its lifecycle. Operations teams can query this table directly to answer "why is transaction X stuck?" without correlating events across services.

2. **Explicit compensation:** The orchestrator knows exactly which steps completed and explicitly calls compensating actions in reverse. With choreography, each service must infer when to compensate based on events it receives — this logic is duplicated and harder to audit.

3. **Deterministic step ordering:** The saga steps are a fixed sequence with known failure modes. An orchestrator is the natural fit for a well-defined, non-branching workflow.

4. **Regulatory auditability:** In a regulated banking context, regulators may ask for an explanation of why a specific transaction failed. A central orchestrator with persistent state provides this answer directly.

---

## The Saga Orchestrator

The `TransactionSagaOrchestrator` is a Spring component in the `transaction-service` module.

### Location and Responsibility

```
transaction-service/
└── src/main/java/com/banking/transaction/
    └── saga/
        ├── TransactionSagaOrchestrator.java   ← main orchestrator
        ├── SagaState.java                     ← JPA entity
        ├── SagaStatus.java                    ← enum of all states
        ├── SagaStep.java                      ← enum of step names
        └── steps/
            ├── ReserveBalanceStep.java
            ├── RequestFraudCheckStep.java
            ├── ApplyDebitStep.java
            ├── ApplyCreditStep.java
            └── compensation/
                ├── ReleaseBalanceStep.java
                └── ReverseDebitStep.java
```

### Orchestrator Responsibilities

1. **Initiate** a saga when a new transfer request is received via the gateway REST call.
2. **Persist** the current saga state to the `saga_state` table before advancing each step.
3. **Call** account-service REST endpoints for balance operations (synchronous steps).
4. **Publish** Kafka events to trigger asynchronous steps (fraud check).
5. **Consume** Kafka events that represent step completions (fraud.decision).
6. **Advance** the state machine when a step completes successfully.
7. **Trigger compensation** when any step fails.
8. **Mark** the saga terminal (COMPLETED or FAILED) when the sequence ends.

---

## Saga State Machine

### State Diagram (Happy Path and Compensation Paths)

```
                        ┌─────────────────────────────────────┐
                        │            CLIENT REQUEST           │
                        │        POST /transfers              │
                        └──────────────────┬──────────────────┘
                                           │
                                           ▼
                                    ┌────────────┐
                                    │    INIT    │
                                    └─────┬──────┘
                                          │ Step 1: Reserve balance
                                          │ (REST → account-service)
                               ┌──────────┴────────────┐
                               │ SUCCESS               │ FAILURE
                               ▼                       ▼
                    ┌─────────────────────┐   ┌──────────────────────────┐
                    │  BALANCE_RESERVED   │   │         FAILED           │
                    └──────────┬──────────┘   │  (no compensation needed)│
                               │              └──────────────────────────┘
                               │ Step 2: Publish transaction.initiated
                               │ (Kafka via outbox)
                               │
                               ▼
                    ┌─────────────────────┐
                    │  FRAUD_CHECK_SENT   │◄─── (timeout watch begins)
                    └──────────┬──────────┘
                               │ Consume fraud.decision
                    ┌──────────┴────────────┐
                    │ APPROVED             │ REJECTED
                    ▼                       ▼
         ┌───────────────────┐    ┌──────────────────────────────┐
         │  FRAUD_APPROVED   │    │  COMPENSATION_RELEASE_BALANCE│
         └────────┬──────────┘    └──────────────┬───────────────┘
                  │ Step 3: Apply debit           │ REST: release reservation
                  │ (REST → account-service)      │ → account-service
         ┌────────┴──────────┐                   ▼
         │ SUCCESS           │ FAILURE   ┌────────────────┐
         ▼                   ▼           │     FAILED     │
┌──────────────────┐  ┌─────────────────────────────────┐
│ DEBIT_COMPLETED  │  │  COMPENSATION_RELEASE_BALANCE   │
└────────┬─────────┘  └────────────┬────────────────────┘
         │                         │ REST: release reservation
         │ Step 4: Apply credit    ▼ → account-service
         │ (REST → account-service)│
┌────────┴──────────┐     ┌────────────────┐
│ SUCCESS           │     │     FAILED     │
▼                   │     └────────────────┘
┌────────────────────┐    │
│  CREDIT_COMPLETED  │    │ FAILURE
└────────┬───────────┘    ▼
         │        ┌──────────────────────────┐
         │        │ COMPENSATION_REVERSE_DEBIT│
         │        └──────────────┬───────────┘
         │                       │ REST: reverse debit
         │                       │ → account-service
         │                       ▼
         │              ┌────────────────┐
         │              │     FAILED     │
         │              └────────────────┘
         │
         ▼
 ┌────────────────────┐
 │     COMPLETED      │ ← terminal state (happy path)
 └────────────────────┘


 Terminal states:  COMPLETED, FAILED
 Compensation states: COMPENSATION_RELEASE_BALANCE, COMPENSATION_REVERSE_DEBIT
```

### State Transition Table

| From State                    | Trigger                          | To State                        |
|-------------------------------|----------------------------------|---------------------------------|
| INIT                          | Balance reservation success      | BALANCE_RESERVED                |
| INIT                          | Balance reservation failure      | FAILED                          |
| BALANCE_RESERVED              | transaction.initiated published  | FRAUD_CHECK_SENT                |
| FRAUD_CHECK_SENT              | fraud.decision = APPROVED        | FRAUD_APPROVED                  |
| FRAUD_CHECK_SENT              | fraud.decision = REJECTED        | COMPENSATION_RELEASE_BALANCE    |
| FRAUD_CHECK_SENT              | Timeout exceeded                 | COMPENSATION_RELEASE_BALANCE    |
| FRAUD_APPROVED                | Debit success                    | DEBIT_COMPLETED                 |
| FRAUD_APPROVED                | Debit failure                    | COMPENSATION_RELEASE_BALANCE    |
| DEBIT_COMPLETED               | Credit success                   | CREDIT_COMPLETED                |
| DEBIT_COMPLETED               | Credit failure                   | COMPENSATION_REVERSE_DEBIT      |
| CREDIT_COMPLETED              | Internal: record finalized       | COMPLETED                       |
| COMPENSATION_RELEASE_BALANCE  | Release success                  | FAILED                          |
| COMPENSATION_RELEASE_BALANCE  | Release failure                  | FAILED (retry compensation)     |
| COMPENSATION_REVERSE_DEBIT    | Reverse debit success            | FAILED                          |
| COMPENSATION_REVERSE_DEBIT    | Reverse debit failure            | FAILED (retry compensation)     |

---

## Saga Steps Reference

### Step 1: Reserve Balance

| Attribute           | Value                                                                                   |
|---------------------|-----------------------------------------------------------------------------------------|
| Step name           | `RESERVE_BALANCE`                                                                       |
| Execution type      | Synchronous REST                                                                        |
| Action              | `POST /internal/accounts/{sourceAccountId}/reservations` with amount and reservationId  |
| Compensating action | `DELETE /internal/accounts/{sourceAccountId}/reservations/{reservationId}`             |
| Kafka event produced| None (REST-only step)                                                                   |
| Kafka event consumed| None                                                                                    |
| Success state       | BALANCE_RESERVED                                                                        |
| Failure state       | FAILED (no compensation needed — nothing has been modified yet)                        |
| Idempotency         | `reservationId` UUID is generated at saga start; account-service upserts on this key  |

### Step 2: Request Fraud Check

| Attribute           | Value                                                                                   |
|---------------------|-----------------------------------------------------------------------------------------|
| Step name           | `REQUEST_FRAUD_CHECK`                                                                   |
| Execution type      | Asynchronous Kafka (via outbox)                                                         |
| Action              | Insert `transaction.initiated` event to outbox; OutboxEventRelay publishes to Kafka    |
| Compensating action | None (publishing an event cannot be undone; fraud-service handles the event idempotently)|
| Kafka event produced| `transaction.initiated`                                                                 |
| Kafka event consumed| `fraud.decision` (in Step 3 below)                                                     |
| Success state       | FRAUD_CHECK_SENT                                                                        |
| Failure state       | Outbox write failure → stays in BALANCE_RESERVED until retry                           |

### Step 3: Process Fraud Decision

| Attribute           | Value                                                                                   |
|---------------------|-----------------------------------------------------------------------------------------|
| Step name           | `PROCESS_FRAUD_DECISION`                                                                |
| Execution type      | Asynchronous Kafka consumption                                                          |
| Action              | Consume `fraud.decision`; if APPROVED advance to FRAUD_APPROVED; if REJECTED compensate|
| Compensating action | `DELETE /internal/accounts/{sourceAccountId}/reservations/{reservationId}` (release hold)|
| Kafka event produced| None (state transition triggers Step 4)                                                |
| Kafka event consumed| `fraud.decision`                                                                        |
| On APPROVED         | State → FRAUD_APPROVED                                                                  |
| On REJECTED         | State → COMPENSATION_RELEASE_BALANCE → run compensating action → FAILED               |

### Step 4: Apply Debit

| Attribute           | Value                                                                                   |
|---------------------|-----------------------------------------------------------------------------------------|
| Step name           | `APPLY_DEBIT`                                                                           |
| Execution type      | Synchronous REST                                                                        |
| Action              | `POST /internal/accounts/{sourceAccountId}/debits` with amount and transactionId        |
| Compensating action | `POST /internal/accounts/{sourceAccountId}/debits/{transactionId}/reverse`             |
| Kafka event produced| None                                                                                    |
| Kafka event consumed| None                                                                                    |
| Success state       | DEBIT_COMPLETED                                                                         |
| Failure state       | COMPENSATION_RELEASE_BALANCE (release reservation) → FAILED                           |
| Idempotency         | account-service checks for existing debit by transactionId before applying             |

### Step 5: Apply Credit

| Attribute           | Value                                                                                   |
|---------------------|-----------------------------------------------------------------------------------------|
| Step name           | `APPLY_CREDIT`                                                                          |
| Execution type      | Synchronous REST                                                                        |
| Action              | `POST /internal/accounts/{targetAccountId}/credits` with amount and transactionId       |
| Compensating action | None applied to credit directly; COMPENSATION_REVERSE_DEBIT undoes Step 4             |
| Kafka event produced| `transaction.completed` (via outbox, on success)                                       |
| Kafka event consumed| None                                                                                    |
| Success state       | CREDIT_COMPLETED → COMPLETED                                                            |
| Failure state       | COMPENSATION_REVERSE_DEBIT → FAILED                                                    |
| Idempotency         | account-service checks for existing credit by transactionId before applying            |

### Compensation Step A: Release Balance Reservation

| Attribute           | Value                                                                                   |
|---------------------|-----------------------------------------------------------------------------------------|
| Step name           | `COMPENSATION_RELEASE_BALANCE`                                                          |
| Execution type      | Synchronous REST                                                                        |
| Action              | `DELETE /internal/accounts/{sourceAccountId}/reservations/{reservationId}`             |
| Triggered by        | Fraud rejection, fraud check timeout, debit failure                                     |
| Result state        | FAILED                                                                                  |
| On failure          | Scheduled job retries this compensation until it succeeds or max retries reached       |

### Compensation Step B: Reverse Debit

| Attribute           | Value                                                                                   |
|---------------------|-----------------------------------------------------------------------------------------|
| Step name           | `COMPENSATION_REVERSE_DEBIT`                                                            |
| Execution type      | Synchronous REST                                                                        |
| Action              | `POST /internal/accounts/{sourceAccountId}/debits/{transactionId}/reverse`             |
| Triggered by        | Credit failure after debit already applied                                              |
| Result state        | FAILED                                                                                  |
| On failure          | Scheduled job retries; manual intervention required if max retries exhausted           |

---

## Saga Persistence

### SagaState Entity

```java
@Entity
@Table(name = "saga_state", schema = "transactions")
public class SagaState {

    @Id
    private UUID transactionId;              // matches Transaction.id

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private SagaStatus sagaStatus;          // current state

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private SagaStep currentStep;           // last attempted step

    @Column(columnDefinition = "jsonb")
    private String stepData;               // step-specific context (reservationId, etc.)

    @Column(nullable = false)
    private Instant startedAt;

    @Column
    private Instant lastUpdatedAt;

    @Column
    private Instant completedAt;           // set on COMPLETED or FAILED

    @Version
    private Long version;                  // optimistic locking
}
```

### saga_state Table DDL

```sql
CREATE TABLE transactions.saga_state (
    transaction_id   UUID PRIMARY KEY REFERENCES transactions.transactions(id),
    saga_status      VARCHAR(64)  NOT NULL,
    current_step     VARCHAR(64)  NOT NULL,
    step_data        JSONB,
    started_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_updated_at  TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    version          BIGINT       NOT NULL DEFAULT 0,

    CONSTRAINT chk_saga_status CHECK (
        saga_status IN (
            'INIT', 'BALANCE_RESERVED', 'FRAUD_CHECK_SENT', 'FRAUD_APPROVED',
            'DEBIT_COMPLETED', 'CREDIT_COMPLETED', 'COMPLETED',
            'COMPENSATION_RELEASE_BALANCE', 'COMPENSATION_REVERSE_DEBIT', 'FAILED'
        )
    )
);

CREATE INDEX idx_saga_state_status ON transactions.saga_state (saga_status)
    WHERE saga_status NOT IN ('COMPLETED', 'FAILED');
```

The partial index on non-terminal states ensures the timeout detection job can efficiently query for active sagas without scanning completed records, which grow unboundedly over time.

### stepData JSON Structure

The `stepData` JSONB column stores context that persists across step boundaries:

```json
{
  "reservationId":   "res_a1b2c3d4-...",
  "sourceAccountId": "acc_e5f6a7b8-...",
  "targetAccountId": "acc_c9d0e1f2-...",
  "amount":          "250.00",
  "currency":        "USD",
  "fraudCheckId":    "frd_g3h4i5j6-...",
  "fraudDecision":   "APPROVED",
  "debitAppliedAt":  "2026-06-15T10:30:35.000Z",
  "compensationReason": null
}
```

---

## Timeout Handling

### Why Timeouts Are Necessary

The FRAUD_CHECK_SENT state depends on fraud-service consuming `transaction.initiated` and producing `fraud.decision`. If fraud-service is down, unreachable, or experiencing a processing backlog, the saga can remain in FRAUD_CHECK_SENT indefinitely. Without timeout detection, balance reservations never expire and funds are held indefinitely.

### Timeout Thresholds per Step

| State              | Timeout Threshold | Compensation Action              | Reason                                         |
|--------------------|-------------------|----------------------------------|------------------------------------------------|
| FRAUD_CHECK_SENT   | 30 seconds        | COMPENSATION_RELEASE_BALANCE     | Fraud-service SLA is 10s; 30s allows 2 retries|
| BALANCE_RESERVED   | 60 seconds        | FAILED (no compensation needed)  | Outbox relay should publish within 10s         |
| COMPENSATION_*     | 120 seconds       | Alert + manual intervention      | Compensation must not silently stall           |

### Timeout Detection Job

```java
@Component
public class SagaTimeoutDetector {

    @Scheduled(fixedDelay = 10_000)  // runs every 10 seconds
    @ShedLock(name = "saga-timeout-detector", lockAtMostFor = "PT9S")
    public void detectStuckSagas() {
        Instant fraudCheckTimeout = Instant.now().minus(Duration.ofSeconds(30));
        Instant reservedTimeout   = Instant.now().minus(Duration.ofSeconds(60));

        // Find sagas stuck in FRAUD_CHECK_SENT beyond threshold
        List<SagaState> stuckFraudCheck = sagaStateRepository
            .findByStatusAndLastUpdatedBefore(SagaStatus.FRAUD_CHECK_SENT, fraudCheckTimeout);

        stuckFraudCheck.forEach(saga -> {
            log.warn("Saga {} stuck in FRAUD_CHECK_SENT since {}. Triggering compensation.",
                saga.getTransactionId(), saga.getLastUpdatedAt());
            orchestrator.triggerCompensation(saga, CompensationReason.FRAUD_CHECK_TIMEOUT);
        });

        // Find sagas stuck in BALANCE_RESERVED beyond threshold
        List<SagaState> stuckReserved = sagaStateRepository
            .findByStatusAndLastUpdatedBefore(SagaStatus.BALANCE_RESERVED, reservedTimeout);

        stuckReserved.forEach(saga -> {
            log.warn("Saga {} stuck in BALANCE_RESERVED since {}. Marking FAILED.",
                saga.getTransactionId(), saga.getLastUpdatedAt());
            orchestrator.markFailed(saga, FailureReason.OUTBOX_PUBLISH_TIMEOUT);
        });
    }
}
```

The `@ShedLock` annotation prevents multiple transaction-service replicas from concurrently executing the timeout job, which could cause duplicate compensation actions.

---

## Idempotency

### Duplicate Kafka Event Handling

Because Kafka provides at-least-once delivery, the saga orchestrator may receive the same `fraud.decision` event more than once. This can happen after:
- A consumer group rebalance while the consumer is mid-processing
- A transaction-service pod restart after processing but before committing the Kafka offset

**Guard implemented in the orchestrator:**

```java
@KafkaListener(topics = "fraud.decision", groupId = "transaction-service-saga-group")
public void onFraudDecision(FraudDecisionEvent event) {
    SagaState saga = sagaStateRepository.findById(event.getTransactionId())
        .orElseThrow(() -> new SagaNotFoundException(event.getTransactionId()));

    // Idempotency check: only process if saga is in the expected state
    if (saga.getSagaStatus() != SagaStatus.FRAUD_CHECK_SENT) {
        log.info("Ignoring duplicate fraud.decision for transaction {}. Current saga status: {}",
            event.getTransactionId(), saga.getSagaStatus());
        return;  // offset is committed; event safely discarded
    }

    // Process the decision and advance the state machine
    processDecision(saga, event);
}
```

This pattern applies to every Kafka-consumed step: the orchestrator always checks the current saga state before processing. Any event received when the saga is not in the expected preceding state is silently acknowledged and discarded.

### REST Call Idempotency

All REST calls from the orchestrator to account-service include an idempotency key in a request header:

```
X-Idempotency-Key: <transactionId>:<stepName>
```

Example:
```
X-Idempotency-Key: txn_9f8e7d6c-...:APPLY_DEBIT
```

Account-service stores this key and returns the same response if it receives a duplicate request. This ensures that if the orchestrator's REST call succeeds on the account-service side but the response is lost before the orchestrator processes it (network partition), the retry does not double-apply the balance mutation.

---

## Failure Scenarios

| Failure                                       | Saga State When Failure Occurs | Compensation Run                   | Final State | Money Impact                              |
|-----------------------------------------------|--------------------------------|------------------------------------|-------------|-------------------------------------------|
| Account does not exist                        | INIT                           | None                               | FAILED      | No money moved; no reservation created   |
| Insufficient balance                          | INIT                           | None                               | FAILED      | No money moved; no reservation created   |
| account-service unreachable (reserve)         | INIT → retry                   | None (retried up to 2×, then FAIL) | FAILED      | No reservation created                   |
| Outbox relay fails (txn.initiated not sent)   | BALANCE_RESERVED               | Release reservation (timeout job)  | FAILED      | Reservation created then released        |
| fraud-service down                            | FRAUD_CHECK_SENT               | Release reservation (timeout: 30s) | FAILED      | Reservation created then released        |
| Fraud rejected                                | FRAUD_CHECK_SENT               | Release reservation                | FAILED      | Reservation created then released        |
| account-service unreachable (debit)           | FRAUD_APPROVED → retry         | Release reservation (after retries)| FAILED      | Reservation created then released        |
| Debit succeeds but response lost              | FRAUD_APPROVED                 | Retry debit (idempotent)           | DEBIT_COMPLETED → continue | Debit applied once (idempotency key) |
| account-service unreachable (credit)          | DEBIT_COMPLETED → retry        | Reverse debit (after retries)      | FAILED      | Debit reversed; no net change            |
| Credit succeeds but response lost             | DEBIT_COMPLETED                | Retry credit (idempotent)          | CREDIT_COMPLETED → COMPLETED | Credit applied once |
| Credit reverse fails (worst case)            | COMPENSATION_REVERSE_DEBIT     | Retry + alert                      | FAILED (manual) | Requires manual reconciliation       |
| transaction-service crash mid-saga            | Any state (persisted)          | Timeout job or resume on restart   | Depends on step | Saga resumes from persisted state    |

### Most Critical Failure: Credit Reverse Failure

If the debit has been applied (DEBIT_COMPLETED) but the credit to the target account fails AND the compensating debit reversal also fails, the system enters an inconsistent state:
- The sender's balance has been reduced
- The receiver's balance has not been increased

This is detected by the COMPENSATION_REVERSE_DEBIT state persisting beyond its timeout threshold. A PagerDuty alert fires immediately. The on-call engineer must manually apply a credit reversal to the source account and record a reconciliation entry. This scenario is expected to be extremely rare (requires simultaneous failure of account-service credit AND reverse endpoints) but is documented because it cannot be automated away without risking over-correction.

---

## Monitoring and Alerting

### Metrics

The saga orchestrator records the following Prometheus metrics:

```
# Number of sagas in each state (gauge)
banking_saga_state_count{status="INIT"} 0
banking_saga_state_count{status="FRAUD_CHECK_SENT"} 3
banking_saga_state_count{status="COMPLETED"} 14200
banking_saga_state_count{status="FAILED"} 47

# Saga completion duration histogram (seconds)
banking_saga_duration_seconds_bucket{le="1.0"} 1050
banking_saga_duration_seconds_bucket{le="5.0"} 13100
banking_saga_duration_seconds_bucket{le="30.0"} 14200
banking_saga_duration_seconds_count 14247
banking_saga_duration_seconds_sum 18432.7

# Compensation triggers by reason (counter)
banking_saga_compensation_total{reason="FRAUD_REJECTED"} 120
banking_saga_compensation_total{reason="FRAUD_CHECK_TIMEOUT"} 2
banking_saga_compensation_total{reason="DEBIT_FAILURE"} 1
banking_saga_compensation_total{reason="CREDIT_FAILURE"} 0
```

### Grafana Alert Rules

| Alert Name                  | Condition                                                             | Severity | Action                                     |
|-----------------------------|-----------------------------------------------------------------------|----------|--------------------------------------------|
| SagaStuckInFraudCheck       | `banking_saga_state_count{status="FRAUD_CHECK_SENT"} > 10`          | Warning  | Check fraud-service health and consumer lag|
| SagaCompensationSpike       | `rate(banking_saga_compensation_total[5m]) > 5`                     | Warning  | Check downstream service error rates       |
| SagaInCompensationState     | `banking_saga_state_count{status=~"COMPENSATION.*"} > 0` for 2 min | Critical | Immediate investigation                    |
| SagaDurationP99High         | `histogram_quantile(0.99, rate(banking_saga_duration_seconds_bucket[5m])) > 60` | Warning | Check saga step latencies          |
| StuckCompensationSaga       | Any saga in COMPENSATION_REVERSE_DEBIT for > 120 seconds            | Critical | Page on-call; manual reconciliation needed |

### Operational Runbook Query

To find all stuck sagas and their current state:

```sql
SELECT
    transaction_id,
    saga_status,
    current_step,
    started_at,
    last_updated_at,
    NOW() - last_updated_at AS stuck_duration,
    step_data->>'compensationReason' AS compensation_reason
FROM transactions.saga_state
WHERE saga_status NOT IN ('COMPLETED', 'FAILED')
   OR (saga_status = 'FAILED' AND completed_at > NOW() - INTERVAL '1 hour')
ORDER BY last_updated_at ASC;
```

To check the compensation backlog:

```sql
SELECT saga_status, COUNT(*) as count, MIN(last_updated_at) as oldest
FROM transactions.saga_state
WHERE saga_status LIKE 'COMPENSATION_%'
GROUP BY saga_status;
```

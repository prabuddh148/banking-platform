# ADR-0002: Use Orchestration-Based Saga for Distributed Transaction Management

**Status:** Accepted

**Date:** 2024-01-22

**Deciders:** Platform Engineering Team

**Technical Area:** Distributed Transactions, Saga Pattern

---

## Context

A financial transaction on this platform spans at least two microservices:

1. The **transaction-service** validates the transaction, manages its lifecycle, and persists transaction records.
2. The **account-service** applies the debit to the source account and the credit to the destination account.
3. The **fraud-service** must evaluate the transaction before any money moves.

In a monolithic architecture, these steps would occur in a single ACID database transaction and either all succeed or all roll back atomically. In a microservices architecture with a database-per-service pattern, there is no single database and therefore no distributed ACID transaction available.

**The problem we must solve:** How do we ensure that a transaction either fully completes (source debited AND destination credited AND records updated) or fully compensates (all partial effects are undone), even when individual services or network calls fail?

**Two Saga approaches were evaluated:**

### Choreography-Based Saga

Each service listens for events and autonomously decides what to do next, publishing its own events when done. There is no central coordinator.

Example flow:
- transaction-service publishes `transaction.initiated`
- fraud-service listens, evaluates, publishes `fraud.decision`
- account-service listens for APPROVED decisions, applies debit, publishes `debit.applied`
- transaction-service listens for `debit.applied`, publishes `transaction.completed`

This approach was rejected for the following reasons:

- **Hard to understand the overall flow:** The saga logic is spread across all participating services. To understand the complete transaction lifecycle, a developer must read the event handler code in every service simultaneously. There is no single place to see the state machine.
- **Cyclic dependencies:** Services become implicitly dependent on each other's event contracts. A change to the event format in one service can break multiple consumers in non-obvious ways.
- **Distributed state machine tracking:** Without a central coordinator, there is no single source of truth for "where is this transaction in its lifecycle?" To determine the state of a transaction, you must correlate events across multiple topics and services. This makes debugging, support queries, and saga recovery significantly harder.
- **Compensation is complex:** When something fails mid-saga, triggering the right compensating actions requires careful event design. Each service must know what compensations to trigger, leading to a web of "on failure of X, publish Y so Z can compensate." This logic is easy to get wrong and difficult to test end-to-end.
- **No timeout handling:** Choreography provides no natural place to handle the case where a saga step never completes (e.g., the fraud-service is down for 5 minutes). Implementing timeouts requires a separate saga monitor service, which partially reintroduces centralized coordination anyway.

### Orchestration-Based Saga

A central **saga orchestrator** (residing in the transaction-service) explicitly drives each step by publishing command events, waiting for reply events, and tracking the saga's current state in a dedicated database table.

---

## Decision

We will use **orchestration-based saga** implemented within the **transaction-service**.

The transaction-service contains the `TransactionSagaOrchestrator` component, which:

1. Maintains a `saga_state` table in `transaction_db` with the current step and status for each in-flight saga.
2. Publishes command events to Kafka to instruct other services to perform work.
3. Consumes reply events from Kafka and transitions the saga state machine.
4. Publishes compensating commands when a step fails or times out.
5. Schedules a periodic check for stalled sagas (those in a non-terminal state for more than the configured timeout).

**Saga state machine for a transaction:**

```
INITIATED
    │
    ▼ (publish transaction.initiated)
AWAITING_FRAUD_DECISION
    │
    ├─── [APPROVED] ──────────────────────────────────────────────────┐
    │                                                                  ▼
    │                                                         PROCESSING
    │                                                                  │ (publish transaction.processing)
    │                                                                  ▼
    │                                                     AWAITING_SETTLEMENT
    │                                                                  │
    │                                                                  ├─── [settled] ──► COMPLETED
    │                                                                  │
    │                                                                  └─── [failed] ──► COMPENSATING ──► FAILED
    │
    └─── [REJECTED/TIMEOUT] ──────────────────────────────────────────► FAILED
```

**Compensation steps (COMPENSATING state):**

If settlement fails after debiting the source account, the orchestrator publishes a compensating command to reverse the debit. Compensation always flows backward through the saga steps that already completed.

**Timeout handling:**

A scheduled job runs every 60 seconds and queries for sagas in non-terminal states where `updated_at < NOW() - INTERVAL '5 minutes'`. Timed-out sagas are moved to FAILED and compensating commands are issued.

---

## Consequences

### Positive

**Single source of truth for saga state:** The `saga_state` table in transaction-service is the authoritative record of every transaction's current lifecycle position. Support engineers can query one place to understand the status of any transaction. Debugging reduces to reading one service's logs and one database table.

**Clear, readable business logic:** The saga state machine is expressed as explicit Java code in one class. The entire transaction lifecycle — every step, every failure case, every compensation — is visible in a single file. New team members can understand the full flow by reading `TransactionSagaOrchestrator`.

**Easy timeout handling:** The orchestrator owns the timeout. A simple database query finds all stalled sagas. The compensation logic is in the same class as the forward progress logic.

**Simpler compensation:** The orchestrator knows exactly which steps completed (because it drove each one and recorded the state transition). When compensation is needed, it knows precisely which compensating commands to issue and in which order.

**Testability:** The orchestrator's state machine can be unit tested by mocking Kafka producers and simulating received reply events. Integration tests can drive the saga through each state by publishing mock Kafka messages. End-to-end happy path and failure scenarios are straightforward to script.

**Centralized monitoring:** Saga progress is queryable via SQL. Dashboards can show live counts of sagas in each state, average time per step, and stalled saga counts. Alerts can fire when the number of COMPENSATING sagas spikes.

### Negative

**transaction-service knows too much:** The orchestrator must know about fraud-service and account-service enough to publish commands to them and interpret their replies. This creates a unidirectional dependency from transaction-service to the command/reply event contracts of each participant. A change to how fraud-service expresses its reply requires updating the orchestrator.

**Single point of coordination failure:** If the transaction-service is down, no new sagas can be initiated and no in-flight sagas can advance. The account-service and fraud-service can still handle other requests, but transaction processing halts. Mitigation: deploy multiple transaction-service instances; the saga state in the database allows any instance to pick up where another left off.

**More complex transaction-service:** The transaction-service bears the additional responsibility of the saga coordinator. It has more code, more Kafka topics to interact with, and more failure scenarios to handle. This is accepted because the alternative (distributing this complexity across all services) produces a harder-to-understand and harder-to-debug system overall.

**Eventual consistency still applies:** The orchestrator coordinates via Kafka, which is asynchronous. There will always be a window where the saga state in transaction-service and the state in account-service or fraud-service are temporarily inconsistent. All participants must implement idempotent handlers to handle redelivery gracefully.

---

## References

- [Microservices Patterns - Chris Richardson: Saga Pattern](https://microservices.io/patterns/data/saga.html)
- [Martin Fowler: Saga](https://martinfowler.com/articles/patterns-of-distributed-systems/saga.html)
- ADR-0001: Use Kafka for Asynchronous Communication
- ADR-0003: Outbox Pattern for Reliable Event Publishing
- `transaction-service/src/.../saga/TransactionSagaOrchestrator.java`

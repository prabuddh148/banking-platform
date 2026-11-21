# 0002. Orchestrated saga for money movement

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

A deposit, withdrawal or transfer touches several services, each with its own database:

1. transaction-service records the transaction,
2. fraud-service decides whether it is allowed,
3. account-service changes the balances,
4. notification-service and audit-service react to the result.

We cannot use one distributed (2PC/XA) transaction across these databases. We still need a clear,
reliable answer for every transaction: it either **completes** or **fails**, never stays half-done.

## Decision

We will implement the flow as an **orchestrated saga** owned by **transaction-service**.

- transaction-service keeps a `SagaState` row per transaction with a status:
  `AWAITING_FRAUD_CHECK` → `AWAITING_BALANCE_UPDATE` (or `AWAITING_REVIEW`) → `COMPLETED` / `FAILED`.
- It sends commands/events through the outbox (`TRANSACTION_INITIATED`, `BALANCE_UPDATE_REQUESTED`)
  and reacts to replies (`FRAUD_CLEARED`, `FRAUD_DETECTED`, `BALANCE_UPDATED`, `BALANCE_UPDATE_FAILED`).
- account-service applies debit and credit **atomically in one local DB transaction**, so there is no
  partial balance change to compensate. Compensation on failure = mark the transaction `FAILED` and
  publish `TRANSACTION_FAILED`.
- A scheduled timeout job fails sagas stuck in `AWAITING_FRAUD_CHECK` or `AWAITING_BALANCE_UPDATE`
  longer than `saga.timeout-minutes` (default 15). `AWAITING_REVIEW` waits for a human and is not timed out.

Full state machine: [saga-pattern.md](../architecture/saga-pattern.md).

## Consequences

**Positive**
- One place (transaction-service) knows the state of every transaction; easy to query
  (`GET /api/v1/transactions/{id}/saga`) and to debug.
- Adding a step (e.g. a limits check) means changing one orchestrator, not every service.
- Because the balance step is atomic, compensation logic stays trivial.

**Negative**
- transaction-service becomes a central component; its availability matters.
- The orchestrator must be careful with duplicate and out-of-order replies (it checks the current
  saga status before every transition).

## Alternatives considered

- **Choreography** (each service reacts to the previous one's event, no coordinator) — fewer moving
  parts at first, but the flow becomes hard to see and to change, and timeouts have no owner.
- **Two-phase commit (XA)** — strong consistency but poor availability, not supported well by Kafka,
  and couples all databases. Rejected.
- **Reserve-then-commit balances across two calls** — needs real compensation (release the
  reservation). Not needed because one account-service transaction can debit and credit both accounts.

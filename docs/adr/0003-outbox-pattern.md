# 0003. Transactional outbox for reliable event publishing

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

account-service and transaction-service must both **change their database** and **publish an event**.
Doing these as two separate steps is unsafe:

- DB commit succeeds, Kafka send fails → other services never hear about the change (a transfer
  that is "PENDING" forever, or money moved with no `BALANCE_UPDATED`).
- Kafka send succeeds, DB commit rolls back → other services act on something that never happened.

## Decision

We will use the **transactional outbox pattern** in account-service and transaction-service.

- The business change and an `outbox_events` row are written in the **same DB transaction**.
- `outbox_events` columns: `id` (UUID), `aggregate_type`, `aggregate_id`, `event_type`, `topic`,
  `payload` (TEXT, JSON), `status` (`PENDING` / `PUBLISHED` / `FAILED`), `attempts`, `last_error`,
  `created_at`, `published_at`.
- An `OutboxEventRelay` runs `@Scheduled(fixedDelayString = "${outbox.relay.interval-ms:2000}")`,
  reads up to 100 `PENDING` rows (oldest first), sends each with
  `kafkaTemplate.send(topic, key, payload).get(10, SECONDS)` and marks it `PUBLISHED` with `published_at`.
- On error: `attempts++`, `last_error` is stored; after 5 attempts the row becomes `FAILED`.

fraud-service and notification-service publish directly with `KafkaTemplate` because their events
are derived from an incoming event and can be re-produced by re-consuming (see ADR 0006).

Details: [outbox-pattern.md](../architecture/outbox-pattern.md).

## Consequences

**Positive**
- No lost events and no phantom events: the event exists if and only if the change committed.
- The relay gives natural retry, and the table is an audit trail of what was sent.

**Negative**
- At-least-once: the relay may send a row twice (e.g. crash after send, before the status update),
  so consumers must be idempotent (they are — `processed_events`).
- Up to ~2 s extra latency per step.
- The outbox table grows and needs cleanup (see [data-retention-policy](../database/data-retention-policy.md)).
- `FAILED` rows need an operator (see [outbox-backlog-recovery runbook](../runbooks/outbox-backlog-recovery.md)).

## Alternatives considered

- **Publish after commit (`@TransactionalEventListener`)** — still loses events if the app crashes
  between commit and send.
- **Change Data Capture (Debezium)** — very robust and no polling, but needs Kafka Connect; too heavy
  for this project. The outbox table layout is compatible with Debezium if we switch later.
- **Kafka transactions** — only make Kafka writes atomic, not the DB + Kafka pair.

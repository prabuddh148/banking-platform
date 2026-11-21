# 0001. Use Apache Kafka for asynchronous communication

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

The platform is split into five business services (account, transaction, fraud, notification, audit)
plus an API gateway. Many interactions do not need an immediate answer:

- A transfer must be checked for fraud, then balances must be updated, then the customer notified,
  and every step must be audited.
- Notification and audit should never slow down or break the money flow.
- If one service is down for a few minutes, the others should keep working and catch up later.

If services called each other synchronously over REST, one slow or failed service would block the
whole chain, and we would need retries and timeouts everywhere.

## Decision

We will use **Apache Kafka** as the backbone for service-to-service communication.

- Four domain topics: `banking.account.events`, `banking.transaction.events`, `banking.fraud.events`,
  `banking.notification.events`, each with a `.DLT` dead-letter topic.
- 3 partitions per topic (replication factor 1 locally). The message key is the event's `aggregateId`
  so all events for one account/transaction stay in order on one partition.
- Messages are JSON strings (`StringSerializer` / `StringDeserializer`). Every event extends `BaseEvent`
  from `common-library` and carries `eventId`, `eventType`, `aggregateId`, `occurredAt`, `correlationId`,
  `source`, `schemaVersion`.
- Producers use `acks=all` and `enable.idempotence=true`.
- Consumers are idempotent (a `processed_events` table), use `ack-mode: record`, and send poison
  messages to `<topic>.DLT` after 3 retries 1 second apart.
- REST is still used for client-facing APIs (through the gateway).

## Consequences

**Positive**
- Services are loosely coupled in time: fraud-service can be restarted without losing transfers.
- New consumers (e.g. audit-service) can subscribe without changing producers.
- Kafka keeps messages for a retention period, so events can be replayed.

**Negative / things to manage**
- Eventual consistency: a transfer returns `202 Accepted` and the client must poll
  `GET /api/v1/transactions/{id}/status`.
- At-least-once delivery means every consumer must handle duplicates.
- More infrastructure to run locally (Kafka + Zookeeper/KRaft, Kafka UI).
- Debugging crosses service boundaries; we rely on `correlationId` and the audit log.

## Alternatives considered

- **Synchronous REST between services** — simpler to start, but creates tight runtime coupling and
  cascading failures. Rejected for the money flow.
- **RabbitMQ** — good for task queues, but Kafka's log retention, replay and partition ordering fit
  event-driven design and audit better.
- **Avro + Schema Registry** — stronger typing, but adds another component. JSON with a
  `schemaVersion` field is enough for now (see [schema-evolution-policy](../events/schema-evolution-policy.md)).

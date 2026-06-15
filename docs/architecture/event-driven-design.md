# Event-Driven Design

## Table of Contents

1. [Why Event-Driven](#why-event-driven)
2. [Event Taxonomy](#event-taxonomy)
3. [Event Envelope Structure](#event-envelope-structure)
4. [Event Flow Diagrams](#event-flow-diagrams)
   - [Account Creation Flow](#1-account-creation-flow)
   - [Money Transfer Happy Path](#2-money-transfer-happy-path-fraud-approved)
   - [Money Transfer Fraud Rejection](#3-money-transfer-fraud-rejection-path)
   - [Account Freeze Flow](#4-account-freeze-flow)
5. [Kafka Topic Inventory](#kafka-topic-inventory)
6. [Consumer Group Design](#consumer-group-design)
7. [Ordering Guarantees](#ordering-guarantees)
8. [Idempotency](#idempotency)
9. [Event Versioning Strategy](#event-versioning-strategy)
10. [Error Handling and Dead Letter Topics](#error-handling-and-dead-letter-topics)

---

## Why Event-Driven

The banking platform uses event-driven architecture as the primary coordination mechanism between services for the following reasons:

### Decoupling

Producers publish events to Kafka topics without knowing who consumes them. When account-service publishes `account.created`, it has no compile-time or runtime dependency on notification-service, audit-service, or any other consumer. New consumers can be added (e.g., a KYC-verification service) without modifying account-service. This eliminates the tight coupling that would result from direct REST calls between services.

### Resilience and Temporal Decoupling

A consumer can be offline when an event is published. Kafka durably retains events according to the configured retention policy. When the consumer restarts, it resumes from its last committed offset and processes events it missed. This is fundamentally different from REST, where a transient consumer outage causes permanent message loss (unless the producer implements its own retry queue — which is exactly what the Outbox Pattern provides for the initial Kafka publish).

### Audit Trail

Every domain event is a fact that describes what happened. Because Kafka retains events durably, the event log itself serves as an append-only audit trail. Audit-service projects this log into a queryable PostgreSQL table, but the authoritative record is the Kafka topic. With sufficient retention, the entire system state can be reconstructed by replaying all events.

### Fan-Out

A single event can be consumed by N independent services without any additional publishing cost. The `transaction.completed` event is consumed simultaneously by notification-service (to send a confirmation email/SMS) and audit-service (to record the completion) without the transaction-service needing to know about either. Adding a third consumer (e.g., a reporting service) requires zero changes to transaction-service.

---

## Event Taxonomy

The platform uses three distinct categories of events. Understanding the distinction is important for consumer design.

### Domain Events

Domain events describe something that has already happened within a bounded context. They are facts — past tense, immutable. No consumer can reject a domain event after it has been published; the thing has already occurred.

Examples:
- `AccountCreated` — an account has been successfully created and persisted
- `TransactionCompleted` — a money transfer has been fully committed
- `FraudDetected` — the fraud engine has flagged a transaction

Domain events are produced by the service that owns the aggregate. They are published via the outbox pattern to guarantee atomicity with the underlying database write.

### Integration Events

Integration events carry domain event information across service boundaries. In this platform, all Kafka events are integration events because they flow between services. They are structurally identical to domain events but carry a `sourceService` field in the envelope to indicate origin and a `correlationId` to allow end-to-end tracing of a business flow.

### Commands (Event-Based Commands)

Some Kafka messages are semantically commands — they instruct a service to do something. In this platform, commands are distinguishable by their naming convention: they use imperative naming (e.g., `FraudCheckRequested`) rather than past-tense naming.

Commands are used within the saga orchestration flow:
- `transaction.initiated` — instructs fraud-service to evaluate a transaction
- The saga saga orchestrator produces these rather than a generic "command" topic per convention; the topic name and event type together make the intent clear

---

## Event Envelope Structure

Every event published to Kafka is serialised as JSON and follows a standard envelope structure. This consistency allows consumers, audit-service, and monitoring tooling to parse the envelope without knowing the specific payload schema.

### Envelope Schema

```json
{
  "eventId":       "550e8400-e29b-41d4-a716-446655440000",
  "eventType":     "AccountCreated",
  "aggregateId":   "acc_7f3a2b1c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
  "aggregateType": "Account",
  "correlationId": "req_1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  "causationId":   "550e8400-e29b-41d4-a716-000000000001",
  "sourceService": "account-service",
  "occurredAt":    "2026-06-15T10:30:00.123456Z",
  "version":       1,
  "payload": {
    ...event-specific fields...
  }
}
```

### Field Definitions

| Field          | Type      | Required | Description                                                                                       |
|----------------|-----------|----------|---------------------------------------------------------------------------------------------------|
| `eventId`      | UUID      | Yes      | Globally unique identifier for this event instance. Used for idempotency by consumers.           |
| `eventType`    | String    | Yes      | Discriminator for the payload schema. Follows PascalCase naming (e.g., `TransactionCompleted`). |
| `aggregateId`  | String    | Yes      | Identifier of the business entity this event concerns (accountId, transactionId, etc.).           |
| `aggregateType`| String    | Yes      | Type of the aggregate (`Account`, `Transaction`, `FraudCheck`).                                  |
| `correlationId`| UUID      | Yes      | End-to-end business flow identifier. All events in a transaction flow share the same correlationId. Propagated from the originating HTTP request. |
| `causationId`  | UUID      | Yes      | The `eventId` of the event that caused this event to be produced. Enables causal chain tracing.  |
| `sourceService`| String    | Yes      | The service that produced this event (e.g., `account-service`, `fraud-service`).                |
| `occurredAt`   | ISO-8601  | Yes      | Timestamp at which the domain event occurred (not the time Kafka received it).                  |
| `version`      | Integer   | Yes      | Schema version of the payload. Starts at `1`. Incremented only on breaking changes (rare).      |
| `payload`      | Object    | Yes      | Event-type-specific data. Schema varies per `eventType`.                                         |

### Example: TransactionCompleted Event

```json
{
  "eventId":       "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "eventType":     "TransactionCompleted",
  "aggregateId":   "txn_9f8e7d6c-5b4a-3c2d-1e0f-a1b2c3d4e5f6",
  "aggregateType": "Transaction",
  "correlationId": "req_1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  "causationId":   "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "sourceService": "transaction-service",
  "occurredAt":    "2026-06-15T10:30:45.789012Z",
  "version":       1,
  "payload": {
    "transactionId":    "txn_9f8e7d6c-5b4a-3c2d-1e0f-a1b2c3d4e5f6",
    "sourceAccountId":  "acc_1111aaaa-bbbb-cccc-dddd-eeeeffffgggg",
    "targetAccountId":  "acc_2222hhhh-iiii-jjjj-kkkk-llllmmmmnnn",
    "amount":           "250.00",
    "currency":         "USD",
    "completedAt":      "2026-06-15T10:30:45.700000Z",
    "fraudDecision":    "APPROVED",
    "fraudCheckId":     "frd_3333oooo-pppp-qqqq-rrrr-ssssttttuwww"
  }
}
```

---

## Event Flow Diagrams

### 1. Account Creation Flow

```
Client                api-gateway         account-service         Kafka               notification-svc     audit-svc
  │                       │                      │                   │                       │                 │
  │──POST /accounts───────►│                     │                   │                       │                 │
  │                        │──REST (routed)──────►│                  │                       │                 │
  │                        │                      │                  │                       │                 │
  │                        │                      │ 1. Validate req  │                       │                 │
  │                        │                      │ 2. INSERT account│                       │                 │
  │                        │                      │    (accounts     │                       │                 │
  │                        │                      │    schema)       │                       │                 │
  │                        │                      │ 3. INSERT        │                       │                 │
  │                        │                      │    outbox_events │                       │                 │
  │                        │                      │    (same txn)    │                       │                 │
  │                        │◄──201 Created────────│                  │                       │                 │
  │◄──201 Created──────────│                      │                  │                       │                 │
  │                        │                      │                  │                       │                 │
  │                        │              [OutboxEventRelay polls ~5s later]                 │                 │
  │                        │                      │                  │                       │                 │
  │                        │                      │──account.created─►│                      │                 │
  │                        │                      │  (Kafka publish) │                       │                 │
  │                        │                      │                  │──account.created──────►│                │
  │                        │                      │                  │                       │ 4. Send welcome │
  │                        │                      │                  │                       │    email/SMS    │
  │                        │                      │                  │──account.created───────────────────────►│
  │                        │                      │                  │                       │                 │ 5. Write
  │                        │                      │                  │                       │                 │    audit
  │                        │                      │                  │                       │                 │    record
```

**Key steps:**
1. Gateway validates JWT and routes to account-service.
2. Account-service atomically inserts the account row and an outbox event in the same DB transaction.
3. HTTP 201 is returned to the client immediately — before Kafka publish occurs.
4. OutboxEventRelay publishes `account.created` to Kafka within 5 seconds.
5. notification-service and audit-service consume the event independently and concurrently.

---

### 2. Money Transfer Happy Path (Fraud Approved)

```
Client          gateway     txn-svc (saga)      account-svc     Kafka           fraud-svc       notification-svc    audit-svc
  │                │              │                   │             │                 │                  │               │
  │─POST /transfer─►│             │                   │             │                 │                  │               │
  │                 │─REST route──►│                  │             │                 │                  │               │
  │                 │             │ 1. Create txn     │             │                 │                  │               │
  │                 │             │    record (INIT)  │             │                 │                  │               │
  │                 │             │ 2. REST: reserve  │             │                 │                  │               │
  │                 │             │    balance────────►│            │                 │                  │               │
  │                 │             │◄─200 reserved─────│            │                 │                  │               │
  │                 │             │ 3. Saga→           │             │                 │                  │               │
  │                 │             │    BALANCE_RESERVED│             │                 │                  │               │
  │                 │             │ 4. Outbox: publish │             │                 │                  │               │
  │                 │             │──txn.initiated──────────────────►│                │                  │               │
  │◄─202 Accepted───│◄─202 Accepted│                  │             │                 │                  │               │
  │                 │             │ 5. Saga→           │             │                 │                  │               │
  │                 │             │    FRAUD_CHECK_SENT│             │                 │                  │               │
  │                 │             │                    │             │──txn.initiated──►│                 │               │
  │                 │             │                    │             │                 │ 6. Evaluate      │               │
  │                 │             │                    │             │                 │    rules         │               │
  │                 │             │                    │             │◄─fraud.decision─│                 │               │
  │                 │             │                    │             │  (APPROVED)     │                 │               │
  │                 │             │◄──fraud.decision────────────────│                 │                  │               │
  │                 │             │ 7. Saga→           │             │                 │                  │               │
  │                 │             │    FRAUD_APPROVED  │             │                 │                  │               │
  │                 │             │ 8. REST: debit─────►│           │                 │                  │               │
  │                 │             │◄─200 debited───────│            │                 │                  │               │
  │                 │             │ 9. Saga→           │             │                 │                  │               │
  │                 │             │    DEBIT_COMPLETED │             │                 │                  │               │
  │                 │             │ 10. REST: credit───►│           │                 │                  │               │
  │                 │             │◄─200 credited──────│            │                 │                  │               │
  │                 │             │ 11. Saga→          │             │                 │                  │               │
  │                 │             │     COMPLETED      │             │                 │                  │               │
  │                 │             │ 12. Outbox publish─────────────►│                 │                  │               │
  │                 │             │──txn.completed                  │─txn.completed───►──────────────────►│              │
  │                 │             │                                  │─txn.completed───►──────────────────►──────────────►│
```

**Key steps:**
1. Transaction record created in INIT state.
2. Balance reservation via synchronous REST to account-service.
3. Saga transitions to BALANCE_RESERVED.
4. `transaction.initiated` published to Kafka (via outbox).
5. Client receives 202 Accepted — processing continues asynchronously.
6. Fraud-service evaluates and emits `fraud.decision` APPROVED.
7. Saga consumes decision, transitions to FRAUD_APPROVED.
8-9. Debit applied to source account via REST; saga advances to DEBIT_COMPLETED.
10-11. Credit applied to target account via REST; saga transitions to COMPLETED.
12. `transaction.completed` published; notification and audit consumers react.

---

### 3. Money Transfer Fraud Rejection Path

```
txn-svc (saga)      account-svc     Kafka           fraud-svc       notification-svc    audit-svc
     │                   │             │                 │                  │               │
     │  [After step 5 in happy path — txn.initiated published]             │               │
     │                   │             │──txn.initiated──►│                │               │
     │                   │             │                  │ 1. Evaluate    │               │
     │                   │             │                  │    rules       │               │
     │                   │             │                  │ 2. REJECTED    │               │
     │                   │             │◄─fraud.decision──│               │               │
     │                   │             │  (REJECTED)      │               │               │
     │◄──fraud.decision───────────────│                  │               │               │
     │ 3. Saga consumes  │             │                  │               │               │
     │    REJECTED       │             │                  │               │               │
     │ 4. Compensation:  │             │                  │               │               │
     │    REST release───►│           │                  │               │               │
     │◄─200 released─────│            │                  │               │               │
     │ 5. Saga→FAILED    │             │                  │               │               │
     │ 6. Outbox publish──────────────►│                 │               │               │
     │──txn.failed                     │─txn.failed──────►──────────────►│               │
     │                                 │  fraud-detected──►              │               │
     │                                 │─txn.failed────────────────────────────────────►│
     │                                 │─fraud.detected────────────────────────────────►│
```

**Key steps:**
1. Fraud-service evaluates transaction and produces `fraud.decision` with result REJECTED.
2. Fraud-service also produces `fraud.detected` to signal alerting consumers.
3. Saga orchestrator consumes the REJECTED decision.
4. Compensation: balance reservation is released via REST call to account-service.
5. Saga transitions to FAILED; transaction record updated to FAILED status.
6. `transaction.failed` published to Kafka. Notification-service sends rejection SMS/email. Audit-service records the failure with fraud decision details.

**No money has moved:** The debit and credit steps are never reached. Only the balance reservation is released.

---

### 4. Account Freeze Flow

```
Client / Admin API   gateway      account-service         Kafka           notification-svc    audit-svc
       │                │               │                    │                   │               │
       │─PATCH /accounts│               │                    │                   │               │
       │  /{id}/status  │               │                    │                   │               │
       │  (FROZEN)──────►│             │                    │                   │               │
       │                 │─REST route──►│                   │                   │               │
       │                 │              │ 1. Validate       │                   │               │
       │                 │              │    status trans.  │                   │               │
       │                 │              │    ACTIVE→FROZEN  │                   │               │
       │                 │              │ 2. UPDATE accounts│                   │               │
       │                 │              │    SET status=    │                   │               │
       │                 │              │    FROZEN         │                   │               │
       │                 │              │ 3. INSERT         │                   │               │
       │                 │              │    outbox_events  │                   │               │
       │                 │◄─200 OK──────│                  │                   │               │
       │◄─200 OK─────────│              │                  │                   │               │
       │                 │              │                  │                   │               │
       │                 │     [OutboxEventRelay, ~5s]     │                   │               │
       │                 │              │                  │                   │               │
       │                 │              │──acct.status.changed──────────────────►│             │
       │                 │              │                  │                   │ 4. Send freeze│
       │                 │              │                  │                   │    notification│
       │                 │              │──acct.status.changed──────────────────►──────────────►│
       │                 │              │                  │                   │               │ 5. Record
       │                 │              │                  │                   │               │    freeze
       │                 │              │                  │                   │               │    event
```

**Effect on in-flight transactions:** The account-service enforces that a FROZEN account cannot be the source or target of a new balance reservation. In-flight transactions that already passed the reservation step continue to completion (the reservation was already committed). This is a deliberate design choice: freezing prevents new transactions but does not roll back already-approved ones, which is consistent with standard banking practice.

---

## Kafka Topic Inventory

| Topic                    | Producer            | Consumers                                           | Partition Key  | Purpose                                           |
|--------------------------|---------------------|-----------------------------------------------------|----------------|---------------------------------------------------|
| `account.created`        | account-service     | notification-service, audit-service                 | accountId      | Signals successful account creation               |
| `account.status.changed` | account-service     | notification-service, audit-service                 | accountId      | Account status transition (ACTIVE/FROZEN/CLOSED)  |
| `transaction.initiated`  | transaction-service | fraud-service, audit-service                        | transactionId  | New transfer request; triggers fraud check        |
| `transaction.processing` | transaction-service | transaction-service (internal saga steps)           | transactionId  | Internal saga step signalling                     |
| `transaction.completed`  | transaction-service | notification-service, audit-service                 | transactionId  | Transfer fully committed                          |
| `transaction.failed`     | transaction-service | notification-service, audit-service                 | transactionId  | Transfer rejected or compensation completed       |
| `fraud.decision`         | fraud-service       | transaction-service (saga)                          | transactionId  | Fraud evaluation result (APPROVED/REJECTED)       |
| `fraud.detected`         | fraud-service       | notification-service, audit-service                 | transactionId  | Alert on confirmed fraud                          |
| `notification.requested` | any service         | notification-service                                | userId         | Explicit notification request                    |
| `*.DLT`                  | Spring Kafka         | ops team / replay tooling                          | varies         | Unprocessable messages after max retries          |

---

## Consumer Group Design

Each service has exactly one consumer group per topic it consumes. Consumer groups are named following the convention `<service-name>-group`.

### Consumer Group Registry

| Topic                    | Consumer Service      | Consumer Group                  |
|--------------------------|-----------------------|---------------------------------|
| `account.created`        | notification-service  | `notification-service-group`    |
| `account.created`        | audit-service         | `audit-service-group`           |
| `account.status.changed` | notification-service  | `notification-service-group`    |
| `account.status.changed` | audit-service         | `audit-service-group`           |
| `transaction.initiated`  | fraud-service         | `fraud-service-group`           |
| `transaction.initiated`  | audit-service         | `audit-service-group`           |
| `fraud.decision`         | transaction-service   | `transaction-service-saga-group`|
| `transaction.completed`  | notification-service  | `notification-service-group`    |
| `transaction.completed`  | audit-service         | `audit-service-group`           |
| `transaction.failed`     | notification-service  | `notification-service-group`    |
| `transaction.failed`     | audit-service         | `audit-service-group`           |
| `fraud.detected`         | notification-service  | `notification-service-group`    |
| `fraud.detected`         | audit-service         | `audit-service-group`           |

### Why Separate Consumer Groups Per Service

Kafka delivers each message in a topic to **one consumer per consumer group**. By giving each service its own consumer group, every service receives every message independently. If notification-service and audit-service shared a consumer group, only one of them would receive each event — the other would miss it.

### Offset Management

All services use `enable.auto.commit=false`. Offsets are committed manually after successful processing:

```java
// Spring Kafka configuration (applied to all consumers)
@Bean
public ConsumerFactory<String, String> consumerFactory() {
    Map<String, Object> props = new HashMap<>();
    props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
    props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
    props.put(ConsumerConfig.ISOLATION_LEVEL_CONFIG, "read_committed");
    return new DefaultKafkaConsumerFactory<>(props);
}
```

`AUTO_OFFSET_RESET_CONFIG=earliest` ensures a newly deployed consumer group processes all available messages from the beginning of the topic's retention window, not just new messages. This is important for audit-service bootstrapping.

`ISOLATION_LEVEL_CONFIG=read_committed` ensures consumers only read messages from committed Kafka transactions (relevant when transaction-service uses Kafka transactional producers).

---

## Ordering Guarantees

Kafka guarantees ordering within a partition. Events with the same partition key are always routed to the same partition, so they are delivered in the order they were produced.

### Partition Key Design

| Topic                    | Partition Key    | Why This Key                                                              |
|--------------------------|------------------|---------------------------------------------------------------------------|
| `account.created`        | `accountId`      | All events for a given account land in the same partition                |
| `account.status.changed` | `accountId`      | Status transitions for the same account are processed in creation order  |
| `transaction.initiated`  | `transactionId`  | All saga-related events for a transfer share a partition                 |
| `transaction.completed`  | `transactionId`  | Consumers see initiated then completed in order                           |
| `transaction.failed`     | `transactionId`  | Consistent with completed                                                 |
| `fraud.decision`         | `transactionId`  | Ensures fraud result is processed after the initiated event              |
| `notification.requested` | `userId`         | Notifications for the same user are ordered (avoids out-of-order delivery)|

### Ordering Limitation

Ordering is guaranteed only within a single partition. If two different accounts receive events concurrently, those events may be written to different partitions and processed in any relative order. This is acceptable because account A's events do not have an ordering relationship with account B's events in the business domain.

For the fraud detection flow, `transactionId` as the partition key ensures that the `fraud.decision` event for a transaction is always processed by the same saga orchestrator replica that processed the original state for that transaction's partition.

---

## Idempotency

Because Kafka provides at-least-once delivery semantics (messages may be redelivered after a consumer restart or rebalance), every consumer must be idempotent — processing the same event twice must produce the same outcome as processing it once.

### Idempotency by Service

**account-service (outbox events):**
The outbox relay uses the `eventId` field to detect whether a given event has already been published. The `outbox_events` table row is marked `PUBLISHED` after the first successful Kafka send. A relay run that picks up an already-PUBLISHED row (edge case during crash recovery) skips it.

**fraud-service:**
Before evaluating a transaction, fraud-service checks whether a `fraud_checks` row with `transactionId = ?` already exists. If it does, the existing result is returned without re-evaluation and a new `fraud.decision` event is published with the same content. Processing the same `transaction.initiated` event twice produces the same `fraud.decision` event.

```sql
-- fraud-service idempotency check
INSERT INTO fraud.fraud_checks (transaction_id, decision, evaluated_at, ...)
VALUES (:txnId, :decision, NOW(), ...)
ON CONFLICT (transaction_id) DO NOTHING;
```

**transaction-service (saga orchestrator):**
The saga orchestrator checks the current saga state before applying a transition. If a `fraud.decision` event arrives for a saga that is already in FRAUD_APPROVED or COMPLETED state, the event is acknowledged and discarded without re-processing. The state machine transition is idempotent by design.

```java
// Idempotency guard in saga orchestrator
if (sagaState.getStatus() != SagaStatus.FRAUD_CHECK_SENT) {
    log.info("Skipping fraud.decision for saga {} — already in state {}",
        sagaState.getTransactionId(), sagaState.getStatus());
    return; // acknowledge Kafka offset, do nothing
}
```

**notification-service:**
Notification records are keyed by `eventId`. Before sending a notification, the service checks whether a `notification_log` row with `eventId = ?` already exists. Duplicate events result in a no-op.

**audit-service:**
Audit records are keyed by `eventId` with a unique constraint. Duplicate events result in a PostgreSQL constraint violation that is caught and swallowed — the duplicate is safely ignored and the Kafka offset is committed.

```sql
-- audit-service idempotency
INSERT INTO audit.audit_events (event_id, event_type, aggregate_id, ...)
VALUES (:eventId, :eventType, :aggregateId, ...)
ON CONFLICT (event_id) DO NOTHING;
```

---

## Event Versioning Strategy

The platform follows a conservative event versioning strategy to maintain backward compatibility across rolling deployments and consumer lag scenarios.

### Version 1 (Current) — Additive Only

All changes to existing event schemas are strictly additive:
- New optional fields may be added to `payload` at any time.
- Existing fields are never removed or renamed in the same version.
- Field types are never changed in the same version.

Consumers must be written to ignore unknown fields (Jackson's `FAIL_ON_UNKNOWN_PROPERTIES=false`):

```java
@Bean
public ObjectMapper objectMapper() {
    return JsonMapper.builder()
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .build();
}
```

This ensures that a consumer running an older version of its schema model can still process events produced by a newer service version that has added fields.

### Version Increment Policy

The `version` field in the event envelope is incremented only when a breaking change is unavoidable:
- Removing a field that consumers depend on
- Renaming a field
- Changing the semantic meaning of a field value

When a version bump is required:
1. The producer publishes both the old and new version simultaneously for a deprecation window (minimum 2 deployment cycles).
2. All consumers are updated to handle both versions using a version discriminator.
3. After all consumers have been deployed, the old version production is removed.
4. A topic-level schema registry entry (Confluent Schema Registry or equivalent) is updated.

### Deprecation Process

```
Week 0 : Producer publishes v1 and v2 simultaneously
Week 1 : All consumers updated to handle v1 and v2
Week 2 : Verify no consumer is lagging on v1 events
Week 3 : Producer stops publishing v1
Week 4 : Consumer v1-handling code removed (optional cleanup)
```

Fields in the payload scheduled for removal are marked with a `@Deprecated` annotation in the Java event class and documented in the CHANGELOG with the target removal version.

---

## Error Handling and Dead Letter Topics

### Retry Policy

All consumers use a Spring Kafka `DefaultErrorHandler` with exponential backoff:

```java
@Bean
public DefaultErrorHandler errorHandler(KafkaTemplate<String, String> kafkaTemplate) {
    DeadLetterPublishingRecoverer recoverer =
        new DeadLetterPublishingRecoverer(kafkaTemplate);

    ExponentialBackOffWithMaxRetries backOff = new ExponentialBackOffWithMaxRetries(3);
    backOff.setInitialInterval(1_000L);   // 1 second
    backOff.setMultiplier(2.0);            // 2s, 4s
    backOff.setMaxInterval(10_000L);       // cap at 10 seconds

    return new DefaultErrorHandler(recoverer, backOff);
}
```

### Dead Letter Topics

After exhausting retries, the `DeadLetterPublishingRecoverer` routes the original message to `<topic-name>.DLT`. DLT messages include headers with the original topic, partition, offset, and the exception that caused the failure.

| Original Topic          | Dead Letter Topic             |
|-------------------------|-------------------------------|
| `account.created`       | `account.created.DLT`         |
| `transaction.initiated` | `transaction.initiated.DLT`   |
| `transaction.completed` | `transaction.completed.DLT`   |
| `transaction.failed`    | `transaction.failed.DLT`      |
| `fraud.decision`        | `fraud.decision.DLT`          |
| `fraud.detected`        | `fraud.detected.DLT`          |
| `notification.requested`| `notification.requested.DLT`  |

### DLT Monitoring and Replay

DLT topics are monitored by Prometheus. A Grafana alert fires when any DLT has more than 0 messages in the last 5-minute window. The on-call team investigates the root cause, fixes the consumer if necessary, and replays the DLT messages using a dedicated replay consumer group:

```bash
# Replay DLT messages by resetting the consumer group offset
kafka-consumer-groups.sh \
  --bootstrap-server kafka:9092 \
  --group dlt-replay-group \
  --topic transaction.initiated.DLT \
  --reset-offsets --to-earliest --execute
```

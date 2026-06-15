# Banking Platform — Event Catalog

**Stack:** Java 21 · Spring Boot 3.2.5 · Apache Kafka · PostgreSQL 16
**Last updated:** 2026-06-15

---

## Table of Contents

1. [Overview](#overview)
2. [Event-Driven Architecture](#event-driven-architecture)
3. [Kafka Topic Reference](#kafka-topic-reference)
4. [BaseEvent Envelope](#baseevent-envelope)
5. [Account Events](#account-events)
   - [AccountCreatedEvent](#accountcreatedevent)
   - [AccountStatusChangedEvent](#accountstatuschangedevent)
6. [Transaction Events](#transaction-events)
   - [TransactionInitiatedEvent](#transactioninitiatedevent)
   - [TransactionProcessingEvent](#transactionprocessingevent)
   - [TransactionCompletedEvent](#transactioncompletedevent)
   - [TransactionFailedEvent](#transactionfailedevent)
7. [Fraud Events](#fraud-events)
   - [FraudDecisionEvent](#frauddecisionevent)
   - [FraudDetectedEvent](#frauddetectedevent)
8. [Notification Events](#notification-events)
   - [NotificationRequestedEvent](#notificationrequestedevent)
9. [Idempotency Strategy](#idempotency-strategy)
10. [Error Handling and Dead Letter Topics](#error-handling-and-dead-letter-topics)

---

## Overview

The banking platform uses an **event-driven architecture** built on Apache Kafka to decouple services, ensure reliability at scale, and provide a complete audit trail for every state change. Every significant domain action — account creation, status transitions, transaction lifecycle steps, fraud analysis outcomes, and notification dispatch — is published as an immutable event to a dedicated Kafka topic.

Services communicate exclusively through events. No service calls another service's internal API for core business flows. This design ensures:

- **Loose coupling**: Producers and consumers evolve independently.
- **Replay capability**: Events are retained per topic policy, enabling consumers to replay history for bootstrapping new services or recovering from failures.
- **Auditability**: `audit-service` subscribes to all material topics and persists a tamper-evident log.
- **Resilience**: If a consumer is temporarily unavailable, it catches up from its committed offset when it recovers — no data is lost within the retention window.

---

## Event-Driven Architecture

```
account-service ---> account.created -----------------> notification-service
                                    `----------------> audit-service

account-service ---> account.status.changed ----------> transaction-service
                                           |----------> audit-service
                                           `----------> notification-service

transaction-service ---> transaction.initiated -------> fraud-service
                                               `-------> audit-service

fraud-service ---> fraud.decision --------------------> transaction-service

transaction-service ---> transaction.processing -------> transaction-service (saga)

transaction-service ---> transaction.completed --------> account-service
                                               |---------> notification-service
                                               `---------> audit-service

transaction-service ---> transaction.failed -----------> account-service
                                           |-----------> notification-service
                                           `-----------> audit-service

fraud-service ---> fraud.detected --------------------> audit-service
                                  `------------------> notification-service

any service ---> notification.requested --------------> notification-service
```

**Saga pattern** — Multi-step transactions use the `transaction.processing` topic as an internal saga orchestration channel. `transaction-service` both publishes to and consumes from this topic, advancing the saga state machine through steps (e.g., DEBIT_INITIATED -> DEBIT_CONFIRMED -> CREDIT_INITIATED -> CREDIT_CONFIRMED).

**Transactional outbox** — All services write events to a local `outbox` table within the same PostgreSQL transaction that mutates domain state, then a background relay publishes them to Kafka. This prevents dual-write inconsistencies.

---

## Kafka Topic Reference

| Topic | Partitions | Producer | Consumers | Partition Key | Retention |
|---|---|---|---|---|---|
| `account.created` | 6 | account-service | notification-service, audit-service | `customerId` | 7 days |
| `account.status.changed` | 6 | account-service | transaction-service, audit-service, notification-service | `accountId` | 30 days |
| `transaction.initiated` | 12 | transaction-service | fraud-service, audit-service | `sourceAccountId` | 7 days |
| `transaction.processing` | 12 | transaction-service | transaction-service (self/saga) | `transactionId` | 3 days |
| `transaction.completed` | 12 | transaction-service | account-service, notification-service, audit-service | `transactionId` | 30 days |
| `transaction.failed` | 12 | transaction-service | account-service, notification-service, audit-service | `transactionId` | 30 days |
| `fraud.decision` | 12 | fraud-service | transaction-service | `transactionId` | 7 days |
| `fraud.detected` | 6 | fraud-service | audit-service, notification-service | `accountId` | 90 days |
| `notification.requested` | 6 | any service | notification-service | `recipientId` | 3 days |

> **Replication factor** for all topics: 3 (recommended for production). `min.insync.replicas=2`.

---

## BaseEvent Envelope

Every domain event in the system extends `BaseEvent`. The envelope fields are always present in the JSON payload at the top level alongside the event-specific payload fields.

### Field Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `eventId` | UUID (string) | Yes | Globally unique identifier for this specific event occurrence. Used for deduplication. |
| `eventType` | string (enum) | Yes | Fully qualified event type name, e.g., `ACCOUNT_CREATED`. Maps to a Java `EventType` enum. |
| `aggregateId` | UUID (string) | Yes | The primary domain entity this event belongs to (e.g., `accountId` for account events, `transactionId` for transaction events). |
| `aggregateType` | string | Yes | The domain aggregate class name, e.g., `Account`, `Transaction`, `FraudAlert`. |
| `correlationId` | string | Yes | Propagated across all events triggered by a single user-initiated request. Used to trace a complete business flow in distributed logs and the audit trail. |
| `causationId` | string | Yes | The `eventId` of the immediately preceding event that caused this event to be produced. Forms a causal chain. Equals `correlationId` for the root event. |
| `sourceService` | string | Yes | The service that produced this event, e.g., `account-service`, `transaction-service`, `fraud-service`. |
| `occurredAt` | string (ISO-8601 Instant) | Yes | The UTC timestamp at which the domain state change occurred, not when the message was published. |
| `version` | integer | Yes | Schema version of the event payload. Consumers must inspect this before deserializing to handle backward/forward compatibility. Current baseline is `1`. |

### Java Base Class (reference)

```java
public abstract class BaseEvent {
    private UUID eventId;
    private EventType eventType;
    private UUID aggregateId;
    private String aggregateType;
    private String correlationId;
    private String causationId;
    private String sourceService;
    private Instant occurredAt;
    private int version;
}
```

---

## Account Events

### AccountCreatedEvent

#### Metadata

| Property | Value |
|---|---|
| **Event Name** | `AccountCreatedEvent` |
| **Event Type Enum** | `ACCOUNT_CREATED` |
| **Topic** | `account.created` |
| **Producer** | `account-service` |
| **Consumers** | `notification-service`, `audit-service` |
| **Partition Key** | `customerId` — ensures all events for the same customer land in the same partition, preserving per-customer ordering |
| **Purpose** | Signals that a new bank account has been successfully created and persisted in the system of record |
| **Trigger** | Fired after the `account-service` commits the new `Account` aggregate to PostgreSQL via the transactional outbox |

#### Payload Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `accountId` | UUID (string) | Yes | Unique identifier for the newly created account. This is the aggregate ID. |
| `accountNumber` | string | Yes | Human-readable account number in the format `XXXXXXXXXXXXXX` (14 digits). Masked in logs. |
| `customerId` | UUID (string) | Yes | The customer who owns this account. Also used as the Kafka partition key. |
| `accountType` | string (enum) | Yes | One of: `CHECKING`, `SAVINGS`, `MONEY_MARKET`, `CERTIFICATE_OF_DEPOSIT`. |
| `currency` | string | Yes | ISO 4217 currency code, e.g., `USD`, `EUR`, `GBP`. |

#### JSON Payload Example

```json
{
  "eventId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "eventType": "ACCOUNT_CREATED",
  "aggregateId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "aggregateType": "Account",
  "correlationId": "corr-9f8e7d6c-5b4a-3210-fedc-ba9876543210",
  "causationId": "corr-9f8e7d6c-5b4a-3210-fedc-ba9876543210",
  "sourceService": "account-service",
  "occurredAt": "2026-06-15T08:23:11.452Z",
  "version": 1,
  "accountId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "accountNumber": "10029384756102",
  "customerId": "d3c2b1a0-9876-5432-fedc-ba0987654321",
  "accountType": "CHECKING",
  "currency": "USD"
}
```

#### Idempotency Handling

- **`notification-service`**: Deduplicates on `eventId` using a `processed_events` table (TTL 48 hours). If the same `eventId` is seen twice (due to Kafka at-least-once delivery), the second welcome notification is suppressed.
- **`audit-service`**: Uses a unique constraint on `(eventId, topic)` in the audit log table. Duplicate inserts are silently ignored via `INSERT ... ON CONFLICT DO NOTHING`.

---

### AccountStatusChangedEvent

#### Metadata

| Property | Value |
|---|---|
| **Event Name** | `AccountStatusChangedEvent` |
| **Event Type Enum** | `ACCOUNT_STATUS_CHANGED` |
| **Topic** | `account.status.changed` |
| **Producer** | `account-service` |
| **Consumers** | `transaction-service`, `audit-service`, `notification-service` |
| **Partition Key** | `accountId` — ensures that all status transitions for the same account are processed in order within a consumer group |
| **Purpose** | Communicates that an account's operational status has changed, enabling downstream services to update their local read models and block or allow transactions accordingly |
| **Trigger** | Fired when an operator, automated risk rule, or customer action changes the account status (e.g., activation, suspension, closure) |

#### Payload Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `accountId` | UUID (string) | Yes | The account whose status changed. Also used as the Kafka partition key. |
| `customerId` | UUID (string) | Yes | Owner of the account. Used by `notification-service` to route the alert to the correct customer. |
| `previousStatus` | string (enum) | Yes | The status before the change. One of: `PENDING_ACTIVATION`, `ACTIVE`, `SUSPENDED`, `DORMANT`, `CLOSED`. |
| `newStatus` | string (enum) | Yes | The status after the change. Same enum values as `previousStatus`. |
| `reason` | string | Yes | Human-readable explanation for the status change. Stored in audit log. |

#### JSON Payload Example

```json
{
  "eventId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "eventType": "ACCOUNT_STATUS_CHANGED",
  "aggregateId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "aggregateType": "Account",
  "correlationId": "corr-1a2b3c4d-5e6f-7890-abcd-ef0123456789",
  "causationId": "corr-1a2b3c4d-5e6f-7890-abcd-ef0123456789",
  "sourceService": "account-service",
  "occurredAt": "2026-06-15T09:14:33.891Z",
  "version": 1,
  "accountId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "customerId": "d3c2b1a0-9876-5432-fedc-ba0987654321",
  "previousStatus": "ACTIVE",
  "newStatus": "SUSPENDED",
  "reason": "Suspicious activity detected by fraud system — alert ALT-00291"
}
```

#### Idempotency Handling

- **`transaction-service`**: Maintains a local `account_status_cache` table keyed by `accountId`. On receiving a duplicate `eventId`, it skips the cache update. The check uses a `processed_event_ids` set with a 7-day TTL backed by Redis.
- **`notification-service`**: Checks `eventId` against `processed_events` table before sending the status-change SMS/email alert.
- **`audit-service`**: `ON CONFLICT (eventId) DO NOTHING` prevents duplicate audit log entries.

---

## Transaction Events

### TransactionInitiatedEvent

#### Metadata

| Property | Value |
|---|---|
| **Event Name** | `TransactionInitiatedEvent` |
| **Event Type Enum** | `TRANSACTION_INITIATED` |
| **Topic** | `transaction.initiated` |
| **Producer** | `transaction-service` |
| **Consumers** | `fraud-service`, `audit-service` |
| **Partition Key** | `sourceAccountId` — collocates all outbound transaction events from the same account for velocity-check analysis in `fraud-service` |
| **Purpose** | Announces that a new transaction has been submitted and is pending fraud screening. The transaction is not yet committed to either account balance at this point. |
| **Trigger** | Fired immediately after `transaction-service` persists the `Transaction` aggregate in `INITIATED` status and before any debit/credit operations begin |

#### Payload Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `transactionId` | UUID (string) | Yes | Unique identifier for this transaction. |
| `referenceNumber` | string | Yes | Customer-facing reference number in the format `TXN-YYYYMMDD-XXXXXXXX`. |
| `sourceAccountId` | UUID (string) | Yes | The account being debited. Also the Kafka partition key. |
| `targetAccountId` | UUID (string) | Yes | The account being credited. May be internal or external (in which case it references a beneficiary record). |
| `amount` | string (decimal) | Yes | Transaction amount as a string to avoid floating-point precision loss, e.g., `"1500.00"`. Always positive. |
| `currency` | string | Yes | ISO 4217 currency code of the transaction amount. |

#### JSON Payload Example

```json
{
  "eventId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
  "eventType": "TRANSACTION_INITIATED",
  "aggregateId": "77a8b9c0-d1e2-f345-6789-0abcdef01234",
  "aggregateType": "Transaction",
  "correlationId": "corr-2b3c4d5e-6f70-8192-bcde-f01234567890",
  "causationId": "corr-2b3c4d5e-6f70-8192-bcde-f01234567890",
  "sourceService": "transaction-service",
  "occurredAt": "2026-06-15T10:05:44.217Z",
  "version": 1,
  "transactionId": "77a8b9c0-d1e2-f345-6789-0abcdef01234",
  "referenceNumber": "TXN-20260615-A9F3C2B1",
  "sourceAccountId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "targetAccountId": "e56fb21c-69dd-5483-b678-1f13c3d4e580",
  "amount": "1500.00",
  "currency": "USD"
}
```

#### Idempotency Handling

- **`fraud-service`**: Each `transactionId` maps to exactly one fraud assessment. On duplicate event delivery, `fraud-service` checks its `fraud_assessments` table for an existing record with the same `transactionId`. If found, it re-publishes the existing `FraudDecisionEvent` to `fraud.decision` to unblock the saga (safe because `FraudDecisionEvent` itself is idempotent for the consumer).
- **`audit-service`**: `ON CONFLICT (eventId) DO NOTHING`.

---

### TransactionProcessingEvent

#### Metadata

| Property | Value |
|---|---|
| **Event Name** | `TransactionProcessingEvent` |
| **Event Type Enum** | `TRANSACTION_PROCESSING` |
| **Topic** | `transaction.processing` |
| **Producer** | `transaction-service` |
| **Consumers** | `transaction-service` (self — saga orchestration) |
| **Partition Key** | `transactionId` — guarantees that all saga steps for the same transaction are processed sequentially by the same consumer instance |
| **Purpose** | Internal saga heartbeat event that advances the transaction state machine through discrete processing steps. Not intended for consumption by external services. |
| **Trigger** | Emitted at each step transition in the transaction saga (e.g., after fraud approval, after debit posted, after credit posted) |

#### Payload Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `transactionId` | UUID (string) | Yes | The transaction being advanced through the saga. |
| `currentStep` | string (enum) | Yes | The step just completed. One of: `FRAUD_APPROVED`, `DEBIT_INITIATED`, `DEBIT_CONFIRMED`, `CREDIT_INITIATED`, `CREDIT_CONFIRMED`, `SETTLEMENT_PENDING`. |
| `timestamp` | string (ISO-8601 Instant) | Yes | When this step transition occurred. Distinct from `occurredAt` on the envelope, which records domain event time; this field records the saga step time for debugging step latency. |

#### JSON Payload Example

```json
{
  "eventId": "d4e5f6a7-b8c9-0123-def0-234567890123",
  "eventType": "TRANSACTION_PROCESSING",
  "aggregateId": "77a8b9c0-d1e2-f345-6789-0abcdef01234",
  "aggregateType": "Transaction",
  "correlationId": "corr-2b3c4d5e-6f70-8192-bcde-f01234567890",
  "causationId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
  "sourceService": "transaction-service",
  "occurredAt": "2026-06-15T10:05:51.088Z",
  "version": 1,
  "transactionId": "77a8b9c0-d1e2-f345-6789-0abcdef01234",
  "currentStep": "FRAUD_APPROVED",
  "timestamp": "2026-06-15T10:05:51.082Z"
}
```

#### Idempotency Handling

- **`transaction-service` (self)**: The saga state machine persists the current step in the `transactions` table. Before acting on a `TransactionProcessingEvent`, the consumer checks whether the incoming `currentStep` matches the expected next step for that `transactionId`. If the event reflects an already-completed step, the message is acknowledged and discarded without side effects. This prevents double-debits or double-credits on redelivery.

---

### TransactionCompletedEvent

#### Metadata

| Property | Value |
|---|---|
| **Event Name** | `TransactionCompletedEvent` |
| **Event Type Enum** | `TRANSACTION_COMPLETED` |
| **Topic** | `transaction.completed` |
| **Producer** | `transaction-service` |
| **Consumers** | `account-service`, `notification-service`, `audit-service` |
| **Partition Key** | `transactionId` |
| **Purpose** | Signals that all saga steps have succeeded and the funds transfer is fully settled. Consumers use this to finalize balance updates, send confirmation notifications, and seal the audit record. |
| **Trigger** | Emitted after `CREDIT_CONFIRMED` step completes and the transaction aggregate transitions to `COMPLETED` status in PostgreSQL |

#### Payload Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `transactionId` | UUID (string) | Yes | The completed transaction. |
| `referenceNumber` | string | Yes | Customer-facing reference number matching the one on `TransactionInitiatedEvent`. |
| `sourceAccountId` | UUID (string) | Yes | The debited account. |
| `targetAccountId` | UUID (string) | Yes | The credited account. |
| `amount` | string (decimal) | Yes | Final settled amount as a string. |
| `currency` | string | Yes | ISO 4217 currency code of the settled amount. |

#### JSON Payload Example

```json
{
  "eventId": "e5f6a7b8-c9d0-1234-ef01-345678901234",
  "eventType": "TRANSACTION_COMPLETED",
  "aggregateId": "77a8b9c0-d1e2-f345-6789-0abcdef01234",
  "aggregateType": "Transaction",
  "correlationId": "corr-2b3c4d5e-6f70-8192-bcde-f01234567890",
  "causationId": "d4e5f6a7-b8c9-0123-def0-234567890123",
  "sourceService": "transaction-service",
  "occurredAt": "2026-06-15T10:06:02.774Z",
  "version": 1,
  "transactionId": "77a8b9c0-d1e2-f345-6789-0abcdef01234",
  "referenceNumber": "TXN-20260615-A9F3C2B1",
  "sourceAccountId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "targetAccountId": "e56fb21c-69dd-5483-b678-1f13c3d4e580",
  "amount": "1500.00",
  "currency": "USD"
}
```

#### Idempotency Handling

- **`account-service`**: Applies balance finalization within a database transaction that first checks whether `eventId` already exists in the `applied_events` table. If yes, the balance update is skipped. If no, the event ID is inserted and the balance update runs atomically.
- **`notification-service`**: Deduplicates on `eventId` to ensure exactly one "Transaction Successful" SMS/push notification is sent per transaction.
- **`audit-service`**: Unique constraint on `eventId`.

---

### TransactionFailedEvent

#### Metadata

| Property | Value |
|---|---|
| **Event Name** | `TransactionFailedEvent` |
| **Event Type Enum** | `TRANSACTION_FAILED` |
| **Topic** | `transaction.failed` |
| **Producer** | `transaction-service` |
| **Consumers** | `account-service`, `notification-service`, `audit-service` |
| **Partition Key** | `transactionId` |
| **Purpose** | Signals that the transaction could not be completed and any partial state changes have been compensated (saga rollback). Consumers release any holds on funds and notify the customer. |
| **Trigger** | Emitted when the saga terminates abnormally due to a fraud rejection, insufficient funds, timeout, or downstream system error |

#### Payload Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `transactionId` | UUID (string) | Yes | The failed transaction. |
| `referenceNumber` | string | Yes | Customer-facing reference number. |
| `sourceAccountId` | UUID (string) | Yes | The account from which a debit was attempted. |
| `targetAccountId` | UUID (string) | Yes | The account to which a credit was attempted. |
| `amount` | string (decimal) | Yes | The attempted amount as a string. |
| `currency` | string | Yes | ISO 4217 currency code. |
| `failureReason` | string (enum) | Yes | Machine-readable failure category. One of: `FRAUD_REJECTED`, `INSUFFICIENT_FUNDS`, `ACCOUNT_SUSPENDED`, `ACCOUNT_CLOSED`, `DAILY_LIMIT_EXCEEDED`, `TIMEOUT`, `DOWNSTREAM_ERROR`. |

#### JSON Payload Example

```json
{
  "eventId": "f6a7b8c9-d0e1-2345-f012-456789012345",
  "eventType": "TRANSACTION_FAILED",
  "aggregateId": "88b9c0d1-e2f3-a456-7890-1bcdef012345",
  "aggregateType": "Transaction",
  "correlationId": "corr-3c4d5e6f-7081-9203-cdef-012345678901",
  "causationId": "a0b1c2d3-e4f5-6789-0abc-def012345678",
  "sourceService": "transaction-service",
  "occurredAt": "2026-06-15T11:03:19.603Z",
  "version": 1,
  "transactionId": "88b9c0d1-e2f3-a456-7890-1bcdef012345",
  "referenceNumber": "TXN-20260615-D7E4F1A2",
  "sourceAccountId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "targetAccountId": "e56fb21c-69dd-5483-b678-1f13c3d4e580",
  "amount": "25000.00",
  "currency": "USD",
  "failureReason": "FRAUD_REJECTED"
}
```

#### Idempotency Handling

- **`account-service`**: Compensation logic (releasing a hold) is guarded by checking `eventId` in the `applied_events` table. Releasing a hold that has already been released is a no-op at the database level, but the guard prevents double-logging of the compensation.
- **`notification-service`**: Deduplicates on `eventId` to prevent duplicate "Transaction Failed" alerts.
- **`audit-service`**: `ON CONFLICT (eventId) DO NOTHING`.

---

## Fraud Events

### FraudDecisionEvent

#### Metadata

| Property | Value |
|---|---|
| **Event Name** | `FraudDecisionEvent` |
| **Event Type Enum** | `FRAUD_DECISION` |
| **Topic** | `fraud.decision` |
| **Producer** | `fraud-service` |
| **Consumers** | `transaction-service` |
| **Partition Key** | `transactionId` — co-located with `transaction.initiated` partition key logic so the saga consumer can correlate requests and responses efficiently |
| **Purpose** | Returns the fraud screening verdict for a specific transaction to the saga orchestrator. `transaction-service` uses this decision to either advance the saga toward settlement or terminate it with a `FRAUD_REJECTED` failure. |
| **Trigger** | Published by `fraud-service` after its rule engine and ML model evaluate the transaction risk profile |

#### Payload Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `transactionId` | UUID (string) | Yes | The transaction that was assessed. Links back to the originating `TransactionInitiatedEvent`. |
| `alertId` | UUID (string) | No | Unique identifier for this fraud assessment record within `fraud-service`. `null` if `decision` is `APPROVED` and no alert was created. |
| `decision` | string (enum) | Yes | The screening outcome. One of: `APPROVED` (proceed), `REJECTED` (block transaction), `MANUAL_REVIEW` (hold pending analyst review). |
| `riskScore` | integer | Yes | Numeric risk score from 0 (lowest risk) to 1000 (highest risk) produced by the ML scoring model. |
| `riskLevel` | string (enum) | Yes | Categorical risk tier derived from `riskScore`. One of: `LOW` (0-299), `MEDIUM` (300-599), `HIGH` (600-849), `CRITICAL` (850-1000). |
| `triggeredRules` | array of string | Yes | List of rule identifiers that fired during evaluation, e.g., `["VELOCITY_HOURLY_LIMIT", "UNUSUAL_GEOGRAPHY"]`. Empty array if no rules fired. |

#### JSON Payload Example (APPROVED)

```json
{
  "eventId": "a7b8c9d0-e1f2-3456-0123-567890123456",
  "eventType": "FRAUD_DECISION",
  "aggregateId": "77a8b9c0-d1e2-f345-6789-0abcdef01234",
  "aggregateType": "Transaction",
  "correlationId": "corr-2b3c4d5e-6f70-8192-bcde-f01234567890",
  "causationId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
  "sourceService": "fraud-service",
  "occurredAt": "2026-06-15T10:05:48.931Z",
  "version": 1,
  "transactionId": "77a8b9c0-d1e2-f345-6789-0abcdef01234",
  "alertId": null,
  "decision": "APPROVED",
  "riskScore": 142,
  "riskLevel": "LOW",
  "triggeredRules": []
}
```

#### JSON Payload Example (REJECTED)

```json
{
  "eventId": "b8c9d0e1-f2a3-4567-1234-678901234567",
  "eventType": "FRAUD_DECISION",
  "aggregateId": "88b9c0d1-e2f3-a456-7890-1bcdef012345",
  "aggregateType": "Transaction",
  "correlationId": "corr-3c4d5e6f-7081-9203-cdef-012345678901",
  "causationId": "a0b1c2d3-e4f5-6789-0abc-def012345678",
  "sourceService": "fraud-service",
  "occurredAt": "2026-06-15T11:03:17.412Z",
  "version": 1,
  "transactionId": "88b9c0d1-e2f3-a456-7890-1bcdef012345",
  "alertId": "39f1a2b3-c4d5-6789-abcd-ef0123456789",
  "decision": "REJECTED",
  "riskScore": 921,
  "riskLevel": "CRITICAL",
  "triggeredRules": ["VELOCITY_HOURLY_LIMIT", "UNUSUAL_GEOGRAPHY", "LARGE_AMOUNT_THRESHOLD"]
}
```

#### Idempotency Handling

- **`transaction-service`**: The saga checks the current transaction status before acting on the decision. If the transaction is already in `FRAUD_APPROVED` or `FRAUD_REJECTED` status (meaning this `FraudDecisionEvent` was previously processed), the event is acknowledged without re-running saga transitions. This prevents double-advancing or double-terminating the saga.

---

### FraudDetectedEvent

#### Metadata

| Property | Value |
|---|---|
| **Event Name** | `FraudDetectedEvent` |
| **Event Type Enum** | `FRAUD_DETECTED` |
| **Topic** | `fraud.detected` |
| **Producer** | `fraud-service` |
| **Consumers** | `audit-service`, `notification-service` |
| **Partition Key** | `accountId` — groups all fraud events for the same account together, enabling `notification-service` to apply per-account notification throttling |
| **Purpose** | Broadcasts a confirmed or high-confidence fraud detection to services that need to act on it beyond blocking the current transaction. `notification-service` sends an immediate security alert to the customer; `audit-service` creates a high-priority audit entry flagged for compliance review. |
| **Trigger** | Published alongside a `REJECTED` or `MANUAL_REVIEW` `FraudDecisionEvent` when `riskLevel` is `HIGH` or `CRITICAL` |

#### Payload Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `alertId` | UUID (string) | Yes | Unique fraud alert identifier. This is the aggregate ID for the `FraudAlert` aggregate. |
| `transactionId` | UUID (string) | Yes | The transaction that triggered the fraud detection. |
| `accountId` | UUID (string) | Yes | The account flagged. Also the Kafka partition key. |
| `riskScore` | integer | Yes | Numeric risk score (0-1000). |
| `riskLevel` | string (enum) | Yes | One of: `HIGH`, `CRITICAL`. Only events at these levels are published to `fraud.detected`. |
| `triggeredRules` | array of string | Yes | List of rule identifiers that contributed to the detection. |
| `decision` | string (enum) | Yes | The action taken. One of: `REJECTED`, `MANUAL_REVIEW`. |

#### JSON Payload Example

```json
{
  "eventId": "c9d0e1f2-a3b4-5678-2345-789012345678",
  "eventType": "FRAUD_DETECTED",
  "aggregateId": "39f1a2b3-c4d5-6789-abcd-ef0123456789",
  "aggregateType": "FraudAlert",
  "correlationId": "corr-3c4d5e6f-7081-9203-cdef-012345678901",
  "causationId": "a0b1c2d3-e4f5-6789-0abc-def012345678",
  "sourceService": "fraud-service",
  "occurredAt": "2026-06-15T11:03:17.550Z",
  "version": 1,
  "alertId": "39f1a2b3-c4d5-6789-abcd-ef0123456789",
  "transactionId": "88b9c0d1-e2f3-a456-7890-1bcdef012345",
  "accountId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "riskScore": 921,
  "riskLevel": "CRITICAL",
  "triggeredRules": ["VELOCITY_HOURLY_LIMIT", "UNUSUAL_GEOGRAPHY", "LARGE_AMOUNT_THRESHOLD"],
  "decision": "REJECTED"
}
```

#### Idempotency Handling

- **`audit-service`**: Unique constraint on `eventId` prevents duplicate high-priority audit entries. Critical fraud alerts are also cross-referenced by `alertId` to prevent multiple compliance-flagged records for the same alert.
- **`notification-service`**: Deduplicates on `eventId` and additionally enforces a per-account notification throttle: at most one fraud alert SMS per account per 5-minute window (tracked in Redis). The `eventId` dedup prevents duplicate sends entirely; the throttle prevents alert fatigue when multiple alerts fire in quick succession for the same account.

---

## Notification Events

### NotificationRequestedEvent

#### Metadata

| Property | Value |
|---|---|
| **Event Name** | `NotificationRequestedEvent` |
| **Event Type Enum** | `NOTIFICATION_REQUESTED` |
| **Topic** | `notification.requested` |
| **Producer** | Any service (`account-service`, `transaction-service`, `fraud-service`) |
| **Consumers** | `notification-service` |
| **Partition Key** | `recipientId` — ensures that notifications to the same recipient are dispatched in order, preventing race conditions when two notifications for the same recipient arrive simultaneously |
| **Purpose** | Decouples notification dispatch from domain services. Any service that needs to send a message to a customer publishes this event rather than calling the notification API directly. `notification-service` owns template resolution, channel selection fallback, and delivery retries. |
| **Trigger** | Published by a domain service when a business event warrants customer communication (e.g., after account creation, after transaction completion, after fraud detection) |

#### Payload Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `recipientId` | UUID (string) | Yes | The customer or user to notify. Also the Kafka partition key. |
| `recipientEmail` | string | No | Email address for delivery via `EMAIL` channel. May be omitted if the producing service does not have PII access; `notification-service` resolves it from the customer profile. |
| `recipientPhone` | string | No | E.164 format phone number for `SMS` or `WHATSAPP` channel delivery. Same resolution logic as `recipientEmail`. |
| `channel` | string (enum) | Yes | Preferred delivery channel. One of: `EMAIL`, `SMS`, `PUSH`, `WHATSAPP`, `IN_APP`. `notification-service` may fall back to a secondary channel if the primary is unavailable. |
| `notificationType` | string (enum) | Yes | Maps to a pre-defined template in the notification-service template registry. E.g., `ACCOUNT_CREATED`, `TRANSACTION_COMPLETED`, `TRANSACTION_FAILED`, `FRAUD_ALERT`, `ACCOUNT_SUSPENDED`. |
| `referenceId` | UUID (string) | Yes | The ID of the domain entity this notification concerns (e.g., `transactionId`, `accountId`, `alertId`). Used by the template engine for deep-linking and by `notification-service` for dedup within a notification type. |
| `templateVariables` | object (string to string map) | Yes | Key-value pairs injected into the notification template at render time. Keys and values depend on `notificationType`. Empty object `{}` is valid if the template requires no variables. |

#### JSON Payload Example (Transaction Completed)

```json
{
  "eventId": "d0e1f2a3-b4c5-6789-3456-890123456789",
  "eventType": "NOTIFICATION_REQUESTED",
  "aggregateId": "d3c2b1a0-9876-5432-fedc-ba0987654321",
  "aggregateType": "Customer",
  "correlationId": "corr-2b3c4d5e-6f70-8192-bcde-f01234567890",
  "causationId": "e5f6a7b8-c9d0-1234-ef01-345678901234",
  "sourceService": "transaction-service",
  "occurredAt": "2026-06-15T10:06:03.112Z",
  "version": 1,
  "recipientId": "d3c2b1a0-9876-5432-fedc-ba0987654321",
  "recipientEmail": "jane.doe@example.com",
  "recipientPhone": "+14155550192",
  "channel": "EMAIL",
  "notificationType": "TRANSACTION_COMPLETED",
  "referenceId": "77a8b9c0-d1e2-f345-6789-0abcdef01234",
  "templateVariables": {
    "customerName": "Jane Doe",
    "referenceNumber": "TXN-20260615-A9F3C2B1",
    "amount": "1500.00",
    "currency": "USD",
    "targetAccountLast4": "6102",
    "occurredAt": "June 15, 2026 at 10:06 AM UTC"
  }
}
```

#### JSON Payload Example (Fraud Alert)

```json
{
  "eventId": "e1f2a3b4-c5d6-7890-4567-901234567890",
  "eventType": "NOTIFICATION_REQUESTED",
  "aggregateId": "d3c2b1a0-9876-5432-fedc-ba0987654321",
  "aggregateType": "Customer",
  "correlationId": "corr-3c4d5e6f-7081-9203-cdef-012345678901",
  "causationId": "c9d0e1f2-a3b4-5678-2345-789012345678",
  "sourceService": "fraud-service",
  "occurredAt": "2026-06-15T11:03:18.001Z",
  "version": 1,
  "recipientId": "d3c2b1a0-9876-5432-fedc-ba0987654321",
  "recipientEmail": null,
  "recipientPhone": "+14155550192",
  "channel": "SMS",
  "notificationType": "FRAUD_ALERT",
  "referenceId": "39f1a2b3-c4d5-6789-abcd-ef0123456789",
  "templateVariables": {
    "customerName": "Jane",
    "alertId": "ALT-00291",
    "blockedAmount": "25000.00",
    "currency": "USD",
    "contactPhone": "1-800-555-BANK"
  }
}
```

#### Idempotency Handling

- **`notification-service`**: Deduplicates on the combination of `(notificationType, referenceId)` with a 24-hour window. This prevents a customer from receiving two "Transaction Completed" emails for the same transaction if `TransactionCompletedEvent` triggers two `NotificationRequestedEvent` publications due to a retry. The `eventId` check provides the first line of defence; the `(notificationType, referenceId)` check is a semantic fallback for cases where two distinct `NotificationRequestedEvent` events carry different `eventId`s but reference the same domain event.

---

## Idempotency Strategy

All consumers in this platform follow a two-level idempotency model.

### Level 1 — Event-level deduplication

Every consumer maintains a `processed_events` store (either a PostgreSQL table or a Redis set with TTL equal to the topic retention period). Before processing any event, the consumer checks whether `eventId` has already been processed.

```sql
-- PostgreSQL pattern used by account-service, notification-service
INSERT INTO processed_events (event_id, topic, processed_at)
VALUES (:eventId, :topic, NOW())
ON CONFLICT (event_id, topic) DO NOTHING;

-- If 0 rows inserted, skip processing
```

### Level 2 — Semantic deduplication

For operations with financial consequences (balance updates, notification sends, saga transitions), services apply a business-level check even after passing Level 1:

- **Balance updates**: Wrapped in a database transaction with a unique constraint on `(account_id, event_id)` in the `account_balance_events` table.
- **Saga transitions**: State machine checks that the incoming step is the expected next step before mutating state.
- **Notification sends**: `(notificationType, referenceId)` uniqueness within a time window prevents duplicate customer-visible messages from semantically equivalent but technically distinct events.

### Retention alignment

The TTL of each `processed_events` store is set to match or exceed the corresponding Kafka topic retention period. This ensures that a consumer can always deduplicate any message that Kafka could possibly redeliver.

| Topic | Retention | processed_events TTL |
|---|---|---|
| `account.created` | 7 days | 8 days |
| `account.status.changed` | 30 days | 31 days |
| `transaction.initiated` | 7 days | 8 days |
| `transaction.processing` | 3 days | 4 days |
| `transaction.completed` | 30 days | 31 days |
| `transaction.failed` | 30 days | 31 days |
| `fraud.decision` | 7 days | 8 days |
| `fraud.detected` | 90 days | 91 days |
| `notification.requested` | 3 days | 4 days |

---

## Error Handling and Dead Letter Topics

Each Kafka consumer group is configured with a Dead Letter Topic (DLT) using Spring Kafka's `DeadLetterPublishingRecoverer`. After 3 retry attempts with exponential backoff (1 s, 2 s, 4 s), an unconsumed or poisoned message is routed to the DLT.

| Source Topic | Dead Letter Topic | Monitored By |
|---|---|---|
| `account.created` | `account.created.DLT` | ops-team alert |
| `account.status.changed` | `account.status.changed.DLT` | ops-team alert |
| `transaction.initiated` | `transaction.initiated.DLT` | ops-team alert + PagerDuty P2 |
| `transaction.processing` | `transaction.processing.DLT` | ops-team alert + PagerDuty P1 |
| `transaction.completed` | `transaction.completed.DLT` | ops-team alert + PagerDuty P1 |
| `transaction.failed` | `transaction.failed.DLT` | ops-team alert |
| `fraud.decision` | `fraud.decision.DLT` | ops-team alert + PagerDuty P1 |
| `fraud.detected` | `fraud.detected.DLT` | ops-team alert |
| `notification.requested` | `notification.requested.DLT` | ops-team alert |

DLT messages include the original message headers plus `kafka_dlt-exception-cause-fqcn`, `kafka_dlt-exception-message`, and `kafka_dlt-original-offset` headers to facilitate debugging and replay.

Messages in DLTs are replayed manually via the internal `event-replay-service` after the root cause is resolved.

---

*This document is the authoritative reference for the banking platform event catalog. All schema changes must be reflected here before the updated event version is deployed to production.*

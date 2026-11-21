# Event Catalog

Every event on the platform, who produces it, who consumes it, and an example payload.

All events extend `BaseEvent` (common-library) and are sent as JSON strings. The Kafka **key** is the
`aggregateId`. Amounts are JSON numbers, ids are strings, times are ISO-8601 instants.

## Common envelope fields

| Field | Type | Description |
|-------|------|-------------|
| `eventId` | string (UUID) | Unique per event; consumers use it for idempotency |
| `eventType` | string | One of the event types below |
| `aggregateId` | string | Kafka key; what the event is about |
| `occurredAt` | string (ISO instant) | When it happened |
| `correlationId` | string | Same for all events of one business flow |
| `source` | string | Producing service |
| `schemaVersion` | integer | Payload version (currently `1`) |

## Summary

| Event | Topic | Producer | Consumers | aggregateId |
|-------|-------|----------|-----------|-------------|
| `ACCOUNT_CREATED` | `banking.account.events` | account-service (outbox) | notification, audit | accountId |
| `ACCOUNT_STATUS_CHANGED` | `banking.account.events` | account-service (outbox) | notification, audit | accountId |
| `BALANCE_UPDATED` | `banking.account.events` | account-service (outbox) | transaction, audit | transactionId |
| `BALANCE_UPDATE_FAILED` | `banking.account.events` | account-service (outbox) | transaction, audit | transactionId |
| `TRANSACTION_INITIATED` | `banking.transaction.events` | transaction-service (outbox) | fraud, audit | transactionId |
| `BALANCE_UPDATE_REQUESTED` | `banking.transaction.events` | transaction-service (outbox) | account, audit | transactionId |
| `TRANSACTION_COMPLETED` | `banking.transaction.events` | transaction-service (outbox) | notification, audit | transactionId |
| `TRANSACTION_FAILED` | `banking.transaction.events` | transaction-service (outbox) | notification, audit | transactionId |
| `FRAUD_CLEARED` | `banking.fraud.events` | fraud-service (direct) | transaction, audit | transactionId |
| `FRAUD_DETECTED` | `banking.fraud.events` | fraud-service (direct) | transaction, audit | transactionId |
| `NOTIFICATION_REQUESTED` | `banking.notification.events` | any service | notification | recipientId |

---

## Account events

### ACCOUNT_CREATED

Published when an account is opened.

| Field | Type | Notes |
|-------|------|-------|
| accountId | string | |
| accountNumber | string | `ACC` + 10 digits |
| customerId | string | e.g. `CUST-1001` |
| customerName, customerEmail, customerPhone | string | phone may be null |
| accountType | string | SAVINGS / CURRENT / FIXED_DEPOSIT |
| currency | string | INR / USD / EUR / GBP |
| initialBalance | number | |

```json
{
  "eventId": "0b8f3c1e-5a7d-4c1b-9b8e-1f2a3c4d5e6f",
  "eventType": "ACCOUNT_CREATED",
  "aggregateId": "a1b2c3d4-0000-4000-8000-000000000001",
  "occurredAt": "2026-11-21T09:00:00.123Z",
  "correlationId": "5d9e2f10-7c3a-4b6e-8f21-3a4b5c6d7e8f",
  "source": "account-service",
  "schemaVersion": 1,
  "accountId": "a1b2c3d4-0000-4000-8000-000000000001",
  "accountNumber": "ACC4821930576",
  "customerId": "CUST-1001",
  "customerName": "Rahul Sharma",
  "customerEmail": "rahul.sharma@example.com",
  "customerPhone": "+919876543210",
  "accountType": "SAVINGS",
  "currency": "INR",
  "initialBalance": 10000.00
}
```

Consumers: notification-service stores the contact and sends a welcome email; audit-service logs (INFO).

### ACCOUNT_STATUS_CHANGED

Published on freeze, unfreeze and close.

| Field | Type | Notes |
|-------|------|-------|
| accountId, accountNumber, customerId | string | |
| customerEmail, customerName | string | |
| previousStatus, newStatus | string | ACTIVE / FROZEN / CLOSED |
| reason | string | nullable |
| changedBy | string | user id of the actor |

```json
{
  "eventId": "7e1d2c3b-4a59-4687-9a0b-c1d2e3f4a5b6",
  "eventType": "ACCOUNT_STATUS_CHANGED",
  "aggregateId": "a1b2c3d4-0000-4000-8000-000000000001",
  "occurredAt": "2026-11-21T10:30:00Z",
  "correlationId": "e4c1a2b3-1111-4222-8333-444455556666",
  "source": "account-service",
  "schemaVersion": 1,
  "accountId": "a1b2c3d4-0000-4000-8000-000000000001",
  "accountNumber": "ACC4821930576",
  "customerId": "CUST-1001",
  "customerEmail": "rahul.sharma@example.com",
  "customerName": "Rahul Sharma",
  "previousStatus": "ACTIVE",
  "newStatus": "FROZEN",
  "reason": "Suspicious activity reported",
  "changedBy": "ADMIN-1"
}
```

Audit severity: WARNING.

### BALANCE_UPDATED

Reply to `BALANCE_UPDATE_REQUESTED` when the money moved.

| Field | Type | Notes |
|-------|------|-------|
| transactionId | string | |
| transactionType | string | DEPOSIT / WITHDRAWAL / TRANSFER |
| sourceAccountId, destinationAccountId | string | nullable depending on type |
| amount | number | |
| currency | string | |
| sourceBalanceAfter, destinationBalanceAfter | number | nullable |

```json
{
  "eventId": "c3d4e5f6-2222-4333-8444-555566667777",
  "eventType": "BALANCE_UPDATED",
  "aggregateId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "occurredAt": "2026-11-21T11:00:04Z",
  "correlationId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "source": "account-service",
  "schemaVersion": 1,
  "transactionId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "transactionType": "TRANSFER",
  "sourceAccountId": "a1b2c3d4-0000-4000-8000-000000000001",
  "destinationAccountId": "b2c3d4e5-0000-4000-8000-000000000002",
  "amount": 1500.00,
  "currency": "INR",
  "sourceBalanceAfter": 8500.00,
  "destinationBalanceAfter": 6500.00
}
```

### BALANCE_UPDATE_FAILED

Reply to `BALANCE_UPDATE_REQUESTED` when a business rule failed. **No balance changed.**

| Field | Type | Notes |
|-------|------|-------|
| transactionId | string | |
| reason | string | human-readable |
| errorCode | string | `INSUFFICIENT_FUNDS`, `ACCOUNT_FROZEN`, `ACCOUNT_CLOSED`, `ACCOUNT_NOT_FOUND`, `CURRENCY_MISMATCH`, `FORBIDDEN` |

```json
{
  "eventId": "d4e5f6a7-3333-4444-8555-666677778888",
  "eventType": "BALANCE_UPDATE_FAILED",
  "aggregateId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "occurredAt": "2026-11-21T11:00:04Z",
  "correlationId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "source": "account-service",
  "schemaVersion": 1,
  "transactionId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "reason": "Insufficient funds: available 500.00, requested 1500.00",
  "errorCode": "INSUFFICIENT_FUNDS"
}
```

Audit severity: WARNING.

---

## Transaction events

### TRANSACTION_INITIATED

Starts the saga. Consumed by fraud-service.

| Field | Type | Notes |
|-------|------|-------|
| transactionId, reference | string | reference = `TXN` + yyyyMMdd + 8 chars |
| transactionType | string | DEPOSIT / WITHDRAWAL / TRANSFER |
| sourceAccountId | string | null for DEPOSIT |
| destinationAccountId | string | null for WITHDRAWAL |
| amount | number | |
| currency | string | |
| initiatedBy | string | user id |
| description | string | nullable |
| clientCountry | string | nullable, from `X-Client-Country` header |

```json
{
  "eventId": "e5f6a7b8-4444-4555-8666-777788889999",
  "eventType": "TRANSACTION_INITIATED",
  "aggregateId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "occurredAt": "2026-11-21T11:00:00Z",
  "correlationId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "source": "transaction-service",
  "schemaVersion": 1,
  "transactionId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "reference": "TXN20261121K7Q2M9XA",
  "transactionType": "TRANSFER",
  "sourceAccountId": "a1b2c3d4-0000-4000-8000-000000000001",
  "destinationAccountId": "b2c3d4e5-0000-4000-8000-000000000002",
  "amount": 1500.00,
  "currency": "INR",
  "initiatedBy": "CUST-1001",
  "description": "Rent share",
  "clientCountry": "IN"
}
```

### BALANCE_UPDATE_REQUESTED

Command to account-service after the fraud check approved.

Fields: transactionId, reference, transactionType, sourceAccountId, destinationAccountId, amount,
currency, initiatedBy.

```json
{
  "eventId": "f6a7b8c9-5555-4666-8777-88889999aaaa",
  "eventType": "BALANCE_UPDATE_REQUESTED",
  "aggregateId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "occurredAt": "2026-11-21T11:00:02Z",
  "correlationId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "source": "transaction-service",
  "schemaVersion": 1,
  "transactionId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "reference": "TXN20261121K7Q2M9XA",
  "transactionType": "TRANSFER",
  "sourceAccountId": "a1b2c3d4-0000-4000-8000-000000000001",
  "destinationAccountId": "b2c3d4e5-0000-4000-8000-000000000002",
  "amount": 1500.00,
  "currency": "INR",
  "initiatedBy": "CUST-1001"
}
```

### TRANSACTION_COMPLETED

Fields: transactionId, reference, transactionType, sourceAccountId, destinationAccountId, amount,
currency, initiatedBy, description, completedAt.

```json
{
  "eventId": "a7b8c9d0-6666-4777-8888-9999aaaabbbb",
  "eventType": "TRANSACTION_COMPLETED",
  "aggregateId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "occurredAt": "2026-11-21T11:00:06Z",
  "correlationId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "source": "transaction-service",
  "schemaVersion": 1,
  "transactionId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "reference": "TXN20261121K7Q2M9XA",
  "transactionType": "TRANSFER",
  "sourceAccountId": "a1b2c3d4-0000-4000-8000-000000000001",
  "destinationAccountId": "b2c3d4e5-0000-4000-8000-000000000002",
  "amount": 1500.00,
  "currency": "INR",
  "initiatedBy": "CUST-1001",
  "description": "Rent share",
  "completedAt": "2026-11-21T11:00:06Z"
}
```

Consumers: notification-service (success email), audit-service (INFO).

### TRANSACTION_FAILED

Fields: transactionId, reference, transactionType, sourceAccountId, destinationAccountId, amount,
currency, initiatedBy, failureReason, failureCode (`FRAUD_BLOCKED`, `INSUFFICIENT_FUNDS`,
`ACCOUNT_FROZEN`, ..., or `TRANSACTION_FAILED` for timeouts).

```json
{
  "eventId": "b8c9d0e1-7777-4888-8999-aaaabbbbcccc",
  "eventType": "TRANSACTION_FAILED",
  "aggregateId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "occurredAt": "2026-11-21T11:00:05Z",
  "correlationId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "source": "transaction-service",
  "schemaVersion": 1,
  "transactionId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "reference": "TXN20261121K7Q2M9XA",
  "transactionType": "TRANSFER",
  "sourceAccountId": "a1b2c3d4-0000-4000-8000-000000000001",
  "destinationAccountId": "b2c3d4e5-0000-4000-8000-000000000002",
  "amount": 1500.00,
  "currency": "INR",
  "initiatedBy": "CUST-1001",
  "failureReason": "Insufficient funds: available 500.00, requested 1500.00",
  "failureCode": "INSUFFICIENT_FUNDS"
}
```

Audit severity: WARNING.

---

## Fraud events

Both share the same fields:

| Field | Type | Notes |
|-------|------|-------|
| transactionId | string | |
| riskScore | integer | 0-100 |
| riskLevel | string | LOW / MEDIUM / HIGH / CRITICAL |
| decision | string | APPROVE / REVIEW / BLOCK |
| triggeredRules | array of string | rule names |
| reason | string | |
| alertId | string | nullable; set when an alert exists |
| reviewedBy | string | nullable; set when an admin decided |

### FRAUD_CLEARED

Always `decision = APPROVE`. Sent automatically for LOW/MEDIUM risk, or after an admin approves an alert.

```json
{
  "eventId": "c9d0e1f2-8888-4999-8aaa-bbbbccccdddd",
  "eventType": "FRAUD_CLEARED",
  "aggregateId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "occurredAt": "2026-11-21T11:00:01Z",
  "correlationId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "source": "fraud-service",
  "schemaVersion": 1,
  "transactionId": "7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10",
  "riskScore": 0,
  "riskLevel": "LOW",
  "decision": "APPROVE",
  "triggeredRules": [],
  "reason": "No fraud rules triggered",
  "alertId": null,
  "reviewedBy": null
}
```

### FRAUD_DETECTED

`decision = REVIEW` (transaction waits for an admin) or `BLOCK` (transaction fails).

```json
{
  "eventId": "d0e1f2a3-9999-4aaa-8bbb-ccccddddeeee",
  "eventType": "FRAUD_DETECTED",
  "aggregateId": "9a8b7c6d-1234-4567-89ab-cdef01234567",
  "occurredAt": "2026-11-21T02:15:01Z",
  "correlationId": "9a8b7c6d-1234-4567-89ab-cdef01234567",
  "source": "fraud-service",
  "schemaVersion": 1,
  "transactionId": "9a8b7c6d-1234-4567-89ab-cdef01234567",
  "riskScore": 65,
  "riskLevel": "HIGH",
  "decision": "REVIEW",
  "triggeredRules": ["AmountThresholdRule", "GeographicRule"],
  "reason": "Amount above 100000; client country US not in allowed list",
  "alertId": "4f3e2d1c-aaaa-4bbb-8ccc-ddddeeeeffff",
  "reviewedBy": null
}
```

Audit severity: CRITICAL for BLOCK, WARNING for REVIEW.

---

## Notification events

### NOTIFICATION_REQUESTED

Any service can ask notification-service to send a message.

| Field | Type | Notes |
|-------|------|-------|
| recipientId | string | user id (also the key) |
| recipientEmail, recipientPhone | string | nullable depending on channel |
| channel | string | EMAIL / SMS / PUSH |
| notificationType | string | free text, e.g. `SECURITY_ALERT` |
| subject | string | |
| message | string | |

```json
{
  "eventId": "e1f2a3b4-aaaa-4bbb-8ccc-ddddeeeeffff",
  "eventType": "NOTIFICATION_REQUESTED",
  "aggregateId": "CUST-1001",
  "occurredAt": "2026-11-21T12:00:00Z",
  "correlationId": "1a2b3c4d-5e6f-4789-8abc-def012345678",
  "source": "fraud-service",
  "schemaVersion": 1,
  "recipientId": "CUST-1001",
  "recipientEmail": "rahul.sharma@example.com",
  "recipientPhone": "+919876543210",
  "channel": "EMAIL",
  "notificationType": "SECURITY_ALERT",
  "subject": "A transaction needs review",
  "message": "We are reviewing a recent transaction on your account."
}
```

Note: audit-service subscribes to the account, transaction and fraud topics, not to the notification topic.

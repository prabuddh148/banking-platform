# Transactional Outbox Pattern

Used by **account-service** and **transaction-service**. Decision record: [ADR 0003](../adr/0003-outbox-pattern.md).

## 1. The problem (dual write)

```java
// UNSAFE
accountRepository.save(account);          // 1. DB write
kafkaTemplate.send(topic, key, payload);   // 2. Kafka write
```

If the app crashes between 1 and 2, or Kafka is down, the DB has the change but nobody hears about
it. If we send first and the DB transaction rolls back, others act on something that never happened.

## 2. The solution

Write the event into a table **in the same transaction** as the business change. A background relay
publishes it later.

```
 ┌─────────────── one DB transaction ───────────────┐
 │  UPDATE account_balances ...                     │
 │  INSERT INTO outbox_events (..., status=PENDING) │
 └──────────────────────────────────────────────────┘
                        │
          OutboxEventRelay (every 2 s)
                        │  SELECT ... WHERE status='PENDING'
                        │  ORDER BY created_at LIMIT 100
                        ▼
              kafkaTemplate.send(topic, key, payload).get(10 s)
                        │
          ok ──► status=PUBLISHED, published_at=now()
          error ► attempts++, last_error=...; attempts>=5 ► status=FAILED
```

## 3. Table: `outbox_events`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `aggregate_type` | VARCHAR | e.g. `ACCOUNT`, `TRANSACTION` |
| `aggregate_id` | VARCHAR | Used as the Kafka key |
| `event_type` | VARCHAR | `EventType` name |
| `topic` | VARCHAR | Target topic |
| `payload` | TEXT | Full event JSON |
| `status` | VARCHAR | `PENDING`, `PUBLISHED`, `FAILED` |
| `attempts` | INT | Default 0 |
| `last_error` | TEXT | Last exception message |
| `created_at` | TIMESTAMPTZ | |
| `published_at` | TIMESTAMPTZ | Null until published |

Index: `(status, created_at)` so the relay query is fast (see [indexing-strategy](../database/indexing-strategy.md)).

## 4. Writing to the outbox

```java
@Transactional
public AccountResponse createAccount(CreateAccountRequest req) {
    Account account = accountRepository.save(...);
    AccountCreatedEvent event = new AccountCreatedEvent(...);
    outboxService.save("ACCOUNT", account.getId().toString(), event); // same transaction
    return mapper.toResponse(account);
}
```

`outboxService.save` serializes the event with Spring's `ObjectMapper` and inserts a `PENDING` row.
It must **not** start a new transaction (default propagation `REQUIRED`).

## 5. The relay

```java
@Scheduled(fixedDelayString = "${outbox.relay.interval-ms:2000}")
public void publishPending() {
    for (OutboxEvent e : repository.findTop100ByStatusOrderByCreatedAtAsc(PENDING)) {
        try {
            kafkaTemplate.send(e.getTopic(), e.getAggregateId(), e.getPayload())
                         .get(10, TimeUnit.SECONDS);
            e.markPublished();               // status=PUBLISHED, publishedAt=now
        } catch (Exception ex) {
            e.recordFailure(ex.getMessage()); // attempts++, lastError; FAILED after 5
        }
        repository.save(e);
    }
}
```

Points to note:
- `fixedDelay` (not `fixedRate`) — the next run starts 2 s after the previous one finished, so runs
  never overlap inside one instance.
- Events are sent oldest-first, which keeps per-aggregate order in the normal case.
- Blocking on `.get(10s)` makes the result explicit; throughput is fine for this scale.
- Configuration: `outbox.relay.interval-ms` (default `2000`).

## 6. Guarantees and trade-offs

- **At-least-once**: a crash after the Kafka send but before marking `PUBLISHED` causes a resend.
  Consumers deduplicate by `eventId`.
- **Latency**: about one relay interval (≤ 2 s) per hop.
- **Poison rows**: after 5 failed attempts a row becomes `FAILED` and stays there until an operator
  acts. A `FAILED` row can block a saga step, which the saga timeout eventually turns into a failed
  transaction. See [outbox-backlog-recovery](../runbooks/outbox-backlog-recovery.md).
- **Growth**: `PUBLISHED` rows are cleaned up by retention (see
  [data-retention-policy](../database/data-retention-policy.md)).

## 7. Useful queries

```sql
-- backlog by status
SELECT status, count(*), min(created_at) AS oldest FROM outbox_events GROUP BY status;

-- what is failing
SELECT id, event_type, aggregate_id, attempts, last_error, created_at
FROM outbox_events WHERE status = 'FAILED' ORDER BY created_at;
```

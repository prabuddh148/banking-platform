# Dead-Letter Topic (DLT) Management

## 1. What goes to a DLT

When a consumer throws an exception while handling a record, Spring Kafka's `DefaultErrorHandler`
retries it **3 times with 1 second between attempts** (`FixedBackOff(1000L, 3)`). If it still fails,
`DeadLetterPublishingRecoverer` publishes the record to `<topic>.DLT` (same partition number) and the
consumer moves on. This stops one bad message from blocking the partition forever.

| Source topic | DLT |
|--------------|-----|
| `banking.account.events` | `banking.account.events.DLT` |
| `banking.transaction.events` | `banking.transaction.events.DLT` |
| `banking.fraud.events` | `banking.fraud.events.DLT` |
| `banking.notification.events` | `banking.notification.events.DLT` |

Note: the DLT is per *source topic*, not per consumer. A record from `banking.transaction.events` that
failed in fraud-service and one that failed in audit-service both land in
`banking.transaction.events.DLT`. Use the headers below to see which consumer failed.

## 2. What does NOT go to a DLT

- **Business failures** (insufficient funds, frozen account, fraud block) are normal outcomes and
  produce events like `BALANCE_UPDATE_FAILED` — not exceptions.
- **Unknown event types** are ignored by design.
- **Duplicates** are skipped by idempotency checks.

So anything in a DLT is a real problem: bad JSON, a missing required field, a bug, or an outage that
lasted longer than the retries (e.g. DB down for > 3 seconds).

## 3. DLT record headers

Spring adds headers to every DLT record:

| Header | Meaning |
|--------|---------|
| `kafka_dlt-original-topic` | Source topic |
| `kafka_dlt-original-partition` | Source partition |
| `kafka_dlt-original-offset` | Source offset |
| `kafka_dlt-original-consumer-group` | Consumer group that failed |
| `kafka_dlt-exception-fqcn` | Exception class |
| `kafka_dlt-exception-message` | Exception message |
| `kafka_dlt-exception-stacktrace` | Stack trace |
| `kafka_dlt-original-timestamp` | Original record timestamp |

## 4. Monitoring

- Alert when any `.DLT` topic's end offset increases (Kafka UI or `kafka_log_log_size` /
  consumer-group metrics in Prometheus).
- Target: **zero** messages in DLTs in steady state.
- Every DLT message must be triaged within 1 business day (DLT retention is 30 days).

## 5. Triage process

1. **Read** the message and headers (see the [dlq-reprocessing runbook](../runbooks/dlq-reprocessing.md)).
2. **Classify**:

| Class | Example | Action |
|-------|---------|--------|
| Transient | DB/Kafka outage longer than retries | Fix the outage, **replay** the message |
| Bug | NullPointerException in a handler | Fix and deploy, then **replay** |
| Bad data | Malformed JSON, missing required field | **Do not replay**. Record the decision; fix the producer; if business impact (e.g. stuck saga), resolve manually |
| Obsolete | Event for a saga already timed out | **Discard** (record why) |

3. **Replay** by re-publishing the original value with the original key to the **source topic**.
   Consumers are idempotent, so re-publishing is safe even if some consumers already processed it.
4. **Record** the action (ticket: event id, class, action, who).

## 6. Design notes

- Replays go to the source topic, so **all** consumer groups receive the message again. That is fine
  because every consumer deduplicates by `eventId` / business key.
- We do not auto-replay DLTs: a poison message would loop forever.
- A future improvement is a small admin tool (or Kafka UI "produce message") that replays a DLT
  record by offset.

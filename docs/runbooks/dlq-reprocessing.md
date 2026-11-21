# Runbook: DLT Reprocessing

**Symptom:** messages appear in `banking.<domain>.events.DLT`. Policy and triage classes:
[dlq-management](../events/dlq-management.md).

```bash
COMPOSE="docker compose -f docker/docker-compose.yml"
K="$COMPOSE exec kafka"
```

## 1. How many and where

```bash
for t in account transaction fraud notification; do
  echo "== banking.$t.events.DLT"
  $K kafka-get-offsets --bootstrap-server kafka:29092 --topic banking.$t.events.DLT
done
```
Each line is `topic:partition:endOffset`. Non-zero means messages exist (compare with what was
already handled — DLTs keep messages for 30 days).

## 2. Read the messages with headers

```bash
$K kafka-console-consumer --bootstrap-server kafka:29092 \
  --topic banking.transaction.events.DLT --from-beginning --timeout-ms 10000 \
  --property print.key=true --property print.headers=true --property print.offset=true
```

Important headers: `kafka_dlt-original-consumer-group`, `kafka_dlt-exception-message`,
`kafka_dlt-original-offset`. Kafka UI (http://localhost:8090 → Topics → `*.DLT` → Messages) shows the
same in a friendlier way.

Note the `eventId`, `eventType` and `aggregateId` from the value.

## 3. Decide

| Question | If yes |
|----------|--------|
| Was it caused by an outage that is now fixed (DB/Kafka down)? | Replay |
| Was it a code bug that is now fixed and deployed? | Replay |
| Is the payload itself invalid (bad JSON, missing required field)? | Do **not** replay; fix the producer; resolve the business effect manually |
| Is the event obsolete (saga already FAILED by timeout)? | Discard, but check [saga-stuck-recovery §5](saga-stuck-recovery.md) |

Check that the event was not already processed:

```sql
-- in the failing consumer's database
SELECT * FROM processed_events WHERE event_id = '<eventId>';
-- audit_db uses a unique event_id on audit_logs instead
SELECT id FROM audit_logs WHERE event_id = '<eventId>';
```

## 4. Replay

Re-publish the **original value** with the **original key** to the **source topic**
(`kafka_dlt-original-topic`). All consumer groups will receive it again; the ones that already
processed it skip it by `eventId`.

1. Save the message value as a single line of JSON, e.g. `replay.json`:
   ```
   7f1c2a9e-4b7d-4a52-9a41-0c3e5d9b8f10|{"eventId":"...","eventType":"BALANCE_UPDATE_REQUESTED",...}
   ```
   (key, a `|` separator, then the JSON value — keep the original `eventId`!)
2. Publish:
   ```bash
   $COMPOSE exec -T kafka kafka-console-producer --bootstrap-server kafka:29092 \
     --topic banking.transaction.events \
     --property parse.key=true --property key.separator='|' < replay.json
   ```
   Or use Kafka UI → Topics → source topic → *Produce Message* (set the key!).
3. Watch the consumer logs for the `eventId`.

Alternative for outbox-produced events: re-queue the original outbox row instead
(`UPDATE outbox_events SET status='PENDING', attempts=0 WHERE id=...`, see
[outbox-backlog-recovery](outbox-backlog-recovery.md)). This uses the exact original payload.

## 5. Record

For every DLT message write down: event id, topic/offset, class, action (replayed / discarded),
person, date. A DLT message without a recorded decision is not "handled".

## 6. Verify

- The affected flow completed (e.g. `GET /api/v1/transactions/{id}/status` = COMPLETED or FAILED with
  a business reason).
- No new DLT messages with the same error.

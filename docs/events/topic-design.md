# Kafka Topic Design

## 1. Naming

```
banking.<domain>.events          e.g. banking.account.events
banking.<domain>.events.DLT      dead-letter topic for that topic
```

- `banking` — platform prefix, so topics can share a cluster with other systems.
- `<domain>` — the owning bounded context: `account`, `transaction`, `fraud`, `notification`.
- `events` — the topic carries facts/events (several event types per topic).
- `.DLT` — suffix used by Spring Kafka's `DeadLetterPublishingRecoverer` (constant
  `EventType.Topics.DLT_SUFFIX` in common-library).

## 2. Topics

| Topic | Owner | Partitions | Replication (local / prod) | Retention |
|-------|-------|-----------|----------------------------|-----------|
| `banking.account.events` | account-service | 3 | 1 / 3 | 7 days |
| `banking.transaction.events` | transaction-service | 3 | 1 / 3 | 7 days |
| `banking.fraud.events` | fraud-service | 3 | 1 / 3 | 7 days |
| `banking.notification.events` | notification-service (any producer) | 3 | 1 / 3 | 3 days |
| `<each>.DLT` | – | 3 | 1 / 3 | 30 days |

In docker-compose the one-shot `kafka-init` container creates all topics (including DLTs) from
`infrastructure/kafka/topics/topics.yaml` / `create-topics.sh` before the services start. The
producers' `NewTopic` beans (3 partitions, replication 1) are a fallback when running services
against a fresh broker; they do not change topics that already exist.
In production, create them up front with replication 3 and `min.insync.replicas=2` so that `acks=all`
really means "written to at least 2 brokers".

## 3. One topic per domain, many event types

We group all events of one domain into one topic instead of one topic per event type.

**Why**
- Ordering: all events about one transaction (`TRANSACTION_INITIATED`, `BALANCE_UPDATE_REQUESTED`,
  `TRANSACTION_COMPLETED`) are on the same topic and, with the same key, the same partition — they are
  read in order.
- Fewer topics to operate.
- Consumers like audit-service subscribe to a few topics and get everything.

**Cost**
- Consumers receive event types they don't need → they must read `eventType` and ignore the rest.

## 4. Keys and partitioning

| Event | Key |
|-------|-----|
| Account lifecycle (`ACCOUNT_CREATED`, `ACCOUNT_STATUS_CHANGED`) | accountId |
| Saga events (`TRANSACTION_*`, `BALANCE_UPDATE_*`, `FRAUD_*`, `BALANCE_UPDATED`) | transactionId |
| `NOTIFICATION_REQUESTED` | recipientId |

The default partitioner hashes the key → same key, same partition → ordered. Do not send events
without a key.

**3 partitions** = at most 3 active consumer instances per consumer group. Increase partitions if a
service needs more parallelism — but note that changing the partition count changes which partition a
key maps to, so ordering is only guaranteed for new messages. Do it during low traffic.

## 5. Consumer groups

| Group id | Subscribes to |
|----------|---------------|
| `account-service` | `banking.transaction.events` |
| `transaction-service` | `banking.fraud.events`, `banking.account.events` |
| `fraud-service` | `banking.transaction.events` |
| `notification-service` | `banking.account.events`, `banking.transaction.events`, `banking.notification.events` |
| `audit-service` | `banking.account.events`, `banking.transaction.events`, `banking.fraud.events` |

Each group tracks its own offsets, so every service gets every message independently.

## 6. Producer and consumer settings

| Setting | Value | Why |
|---------|-------|-----|
| `acks` | `all` | Wait for all in-sync replicas |
| `enable.idempotence` | `true` | No duplicates from producer retries |
| key/value serializer | `StringSerializer` | Payload is JSON text |
| `auto-offset-reset` | `earliest` | A new group reads from the beginning instead of missing events |
| `ack-mode` | `record` | Commit after every record; at most one record re-processed after a crash |
| error handler | `DefaultErrorHandler` + `FixedBackOff(1000, 3)` + DLT | See [dlq-management](dlq-management.md) |

## 7. Inspecting topics

The broker image is Confluent `cp-kafka` 7.6, so the CLI tools have no `.sh` suffix. Inside the
Docker network the broker listens on `kafka:29092`; from your host use `localhost:9092`.

```bash
# use docker/docker-compose.dev.yml instead if you started infra only
docker compose -f docker/docker-compose.yml exec kafka \
  kafka-topics --bootstrap-server kafka:29092 --list

docker compose -f docker/docker-compose.yml exec kafka \
  kafka-topics --bootstrap-server kafka:29092 --describe --topic banking.transaction.events

docker compose -f docker/docker-compose.yml exec kafka \
  kafka-console-consumer --bootstrap-server kafka:29092 \
  --topic banking.transaction.events --from-beginning --property print.key=true
```

Or open Kafka UI at http://localhost:8090.

# Kafka Consumer Lag — Diagnosis and Resolution Runbook

**Banking Platform — On-Call Operations Guide**
Last Updated: 2026-06-15 | Owner: Platform Engineering

---

## Table of Contents

1. [What Is Consumer Lag and Why It Matters](#what-is-consumer-lag)
2. [Lag Thresholds](#lag-thresholds)
3. [Step 1 — Identify Lagging Consumer Groups and Topics](#step-1-identify-lagging-consumer-groups)
4. [Step 2 — Confirm Consumers Are Alive](#step-2-confirm-consumers-are-alive)
5. [Step 3 — Check Service Health](#step-3-check-service-health)
6. [Step 4 — Check for DLT Accumulation](#step-4-check-for-dlt-accumulation)
7. [Step 5 — Check Partition vs Consumer Thread Count](#step-5-check-partition-vs-consumer-thread-count)
8. [Root Causes and Fixes](#root-causes-and-fixes)
9. [Scaling Consumers](#scaling-consumers)
10. [Monitoring Commands and Expected Outputs](#monitoring-commands)
11. [Recovery Validation](#recovery-validation)

---

## What Is Consumer Lag

Consumer lag is the number of messages that have been **published to a Kafka topic** but **not yet consumed and processed** by a consumer group. It represents the backlog of work waiting to be done.

In the banking platform, lag matters because:

- **`transaction.initiated` lag** → pending transfers are not being processed; customers see transactions stuck in "PENDING"
- **`fraud.decision` lag** → saga orchestration is stalled waiting for fraud verdicts; transactions pile up in `STARTED` state
- **`balance.reserved` lag** → account debits/credits are not being applied; balances are incorrect
- **`audit.events` lag** → regulatory audit trail is falling behind (compliance risk)
- **`notification.events` lag** → customer notifications are delayed (lower priority but visible to users)

High lag on core financial topics is a **SEV1 or SEV2 incident** depending on the magnitude and duration.

### Consumer Groups in This Platform

| Consumer Group | Service | Critical Topics Consumed |
|----------------|---------|------------------------|
| `transaction-service-group` | transaction-service (8082) | `transaction.initiated`, `fraud.decision`, `balance.reserved` |
| `account-service-group` | account-service (8081) | `balance.reserve.requested`, `balance.release.requested` |
| `fraud-service-group` | fraud-service (8083) | `transaction.initiated` |
| `notification-service-group` | notification-service (8084) | `notification.events` |
| `audit-service-group` | audit-service (8085) | `audit.events` |

---

## Lag Thresholds

| Level | Threshold | Severity | Action Required |
|-------|-----------|----------|----------------|
| Normal | 0 – 1,000 | — | No action |
| Warning | 1,001 – 10,000 | SEV3 | Investigate during business hours |
| Critical | 10,001 – 50,000 | SEV2 | Immediate investigation required |
| Emergency | > 50,000 | SEV1 | Wake on-call, escalate to IC |

> **Note:** Thresholds apply differently by topic. Lag of 5,000 on `notification.events` is a Warning. Lag of 5,000 on `transaction.initiated` is a Critical — escalate immediately.

---

## Step 1 — Identify Lagging Consumer Groups

### Via CLI (most reliable)

```bash
# List all consumer groups with lag — sort by lag descending
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --all-groups \
  | awk 'NR==1 || $6 ~ /^[0-9]+$/' \
  | sort -k6 -rn \
  | head -30
```

**Expected output columns:** `GROUP | TOPIC | PARTITION | CURRENT-OFFSET | LOG-END-OFFSET | LAG | CONSUMER-ID | HOST | CLIENT-ID`

```
GROUP                        TOPIC                  PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG     CONSUMER-ID  HOST
transaction-service-group    transaction.initiated  0          10234           62891           52657   ...          /172.17.0.3
transaction-service-group    transaction.initiated  1          10198           61944           51746   ...          /172.17.0.3
fraud-service-group          transaction.initiated  0          10234           62891           52657   ...          /172.17.0.4
```

### Via Kafka UI (fastest for a quick view)

1. Open http://localhost:9090
2. Navigate to **Consumer Groups**
3. Click **Lag** column header to sort descending
4. Groups with lag > 10,000 are highlighted in orange/red

### Identify the Specific Topic and Partition

```bash
# Describe a specific consumer group
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --group transaction-service-group
```

Note which **partitions** have lag — if only some partitions lag, the assigned consumer thread may be dead or slow.

---

## Step 2 — Confirm Consumers Are Alive

### Check Consumer Membership

```bash
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --group transaction-service-group
```

**Signs of dead consumers:**
- `CONSUMER-ID` column shows `-` or `EMPTY`
- Fewer consumer entries than partitions

**Healthy output** (2 partitions, 2 consumers):
```
GROUP                      TOPIC                  PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG   CONSUMER-ID                                  HOST
transaction-service-group  transaction.initiated  0          62891           62891           0     transaction-service-0-abc123-...             /172.17.0.3
transaction-service-group  transaction.initiated  1          61944           61944           0     transaction-service-1-def456-...             /172.17.0.3
```

**Dead consumer output** (partitions are unassigned):
```
GROUP                      TOPIC                  PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG    CONSUMER-ID  HOST  CLIENT-ID
transaction-service-group  transaction.initiated  0          10234           62891           52657  -            -     -
transaction-service-group  transaction.initiated  1          10198           61944           51746  -            -     -
```

If consumers show as dead → proceed to Step 3 immediately.

---

## Step 3 — Check Service Health

For each service with a lagging consumer group, check its health endpoint:

```bash
# transaction-service
curl -s http://localhost:8082/actuator/health | jq '{status: .status, kafka: .components.kafka, db: .components.db}'

# account-service
curl -s http://localhost:8081/actuator/health | jq '{status: .status, kafka: .components.kafka, db: .components.db}'

# fraud-service
curl -s http://localhost:8083/actuator/health | jq '{status: .status, kafka: .components.kafka}'

# notification-service
curl -s http://localhost:8084/actuator/health | jq '{status: .status, kafka: .components.kafka}'

# audit-service
curl -s http://localhost:8085/actuator/health | jq '{status: .status, kafka: .components.kafka}'
```

Check service logs for consumer errors:

```bash
# Replace SERVICE_NAME with the relevant Docker container name
docker logs banking-transaction-service --tail 200 --follow \
  | grep -E "ERROR|WARN|KafkaListenerEndpoint|ConsumerRecord|poll timeout|Commit cannot"
```

Common log patterns indicating problems:

| Log Pattern | Meaning |
|------------|---------|
| `Consumer poll timeout` | Consumer taking too long to process — increase `max.poll.interval.ms` or speed up processing |
| `Commit cannot be completed` | Consumer rebalanced mid-processing — usually transient |
| `ListenerExecutionFailedException` | Message processing threw an exception — check DLT |
| `org.springframework.kafka.listener.ListenerExecutionFailedException` | Spring retry exhausted — message went to DLT |
| `Connection to node -1 could not be established` | Cannot reach Kafka broker |

---

## Step 4 — Check for DLT Accumulation

Dead Letter Topics (DLTs) accumulate when messages fail processing and exhaust retries. High DLT lag means poison pills are causing consumer threads to slow down.

```bash
# List all DLT topics
kafka-topics.sh --bootstrap-server localhost:9092 --list | grep "\.DLT"
```

Expected DLT topics:
```
transaction.initiated.DLT
fraud.decision.DLT
balance.reserved.DLT
audit.events.DLT
notification.events.DLT
```

```bash
# Check message count on each DLT (end offset = message count since DLTs are not consumed)
for topic in transaction.initiated.DLT fraud.decision.DLT balance.reserved.DLT; do
  echo "=== $topic ==="
  kafka-run-class.sh kafka.tools.GetOffsetShell \
    --broker-list localhost:9092 \
    --topic $topic \
    --time -1 \
    | awk -F: '{sum += $3} END {print "Total messages:", sum}'
done
```

```bash
# Peek at DLT messages to see the failure reason
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated.DLT \
  --from-beginning \
  --max-messages 5 \
  --property print.headers=true
```

> If DLT has messages → see `docs/runbooks/dlq-reprocessing.md` for detailed replay instructions.

---

## Step 5 — Check Partition vs Consumer Thread Count

A consumer group can only process as many partitions **in parallel** as it has threads assigned. If you have 4 partitions but only 1 consumer thread, throughput is artificially limited.

```bash
# Check number of partitions per topic
kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --topic transaction.initiated
```

Output:
```
Topic: transaction.initiated  TopicId: xxx  PartitionCount: 4  ReplicationFactor: 1
  Topic: transaction.initiated  Partition: 0  Leader: 1  Replicas: 1  Isr: 1
  Topic: transaction.initiated  Partition: 1  Leader: 1  Replicas: 1  Isr: 1
  Topic: transaction.initiated  Partition: 2  Leader: 1  Replicas: 1  Isr: 1
  Topic: transaction.initiated  Partition: 3  Leader: 1  Replicas: 1  Isr: 1
```

```bash
# Check how many consumer threads are actually active
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --group transaction-service-group \
  | grep -v "^$" \
  | tail -n +2 \
  | awk '{print $7}' \
  | sort -u \
  | wc -l
```

**Rule:** Active consumers should equal partition count. If fewer → some partitions are idle.

Check the Spring concurrency config:

```bash
# In running container
docker exec banking-transaction-service env | grep KAFKA_LISTENER_CONCURRENCY

# Or check application config
docker exec banking-transaction-service \
  cat /app/config/application.yml | grep concurrency
```

---

## Root Causes and Fixes

### Cause 1: Consumers Are Down (Service Crashed or Restarted)

**Symptoms:** Consumer group shows `-` for CONSUMER-ID; service health returns DOWN or UNREACHABLE.

**Fix:**
```bash
# Restart the crashed service
docker restart banking-transaction-service

# Verify it starts and consumers rejoin
watch -n 3 'kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --describe --group transaction-service-group | tail -5'

# Wait for lag to start dropping — should begin within 60 seconds
```

### Cause 2: Slow Processing Due to DB Bottleneck

**Symptoms:** Consumers are alive (show CONSUMER-ID) but lag is growing slowly; DB CPU or query latency is high.

**Diagnose:**
```bash
# Check slow queries on transaction_db
psql -h localhost -U postgres -d transaction_db -c "
  SELECT pid,
         now() - pg_stat_activity.query_start AS duration,
         LEFT(query, 120) AS query_snippet,
         state
  FROM pg_stat_activity
  WHERE (now() - pg_stat_activity.query_start) > interval '3 seconds'
    AND state != 'idle'
    AND datname = 'transaction_db'
  ORDER BY duration DESC;"

# Check if connection pool is exhausted
psql -h localhost -U postgres -c "
  SELECT datname, count(*) AS used,
         (SELECT setting::int FROM pg_settings WHERE name='max_connections') AS max
  FROM pg_stat_activity
  WHERE datname = 'transaction_db'
  GROUP BY datname;"
```

**Fix:**
```bash
# Add read replica or increase connection pool in application config
# Edit application.yml or environment variable:
# spring.datasource.hikari.maximum-pool-size=20  (default is 10)

# Restart service to apply
docker restart banking-transaction-service
```

### Cause 3: Poison Pill Causing Retry Loop

**Symptoms:** DLT has messages; consumer lag grows but consumers are alive; logs show repeated `ListenerExecutionFailedException`.

**Fix:** See `docs/runbooks/dlq-reprocessing.md` for full replay procedure.

Quick identification:
```bash
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic transaction.initiated.DLT \
  --from-beginning --max-messages 1 \
  --property print.headers=true \
  | python3 -c "import sys, json; data=sys.stdin.read(); print(data)"
```

### Cause 4: Too Few Partitions vs Consumer Threads

**Symptoms:** Consumers are alive but partition count < desired concurrency; adding more service instances does not reduce lag.

**Fix (requires careful planning — do not do during active incident without IC approval):**
```bash
# Increase partition count for a topic
kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --alter \
  --topic transaction.initiated \
  --partitions 8

# Note: increasing partitions requires consumer rebalance.
# Existing messages on old partitions are not redistributed.
# New messages will use new partition count.
```

> **Warning:** Decreasing partition count is not supported. Partition increases cause a consumer group rebalance which briefly pauses processing (~5–10 seconds). Do not increase partitions on a topic with a running saga in progress without understanding the offset impact.

### Cause 5: GC Pause Causing Poll Timeout

**Symptoms:** Consumer periodically drops out of group and rejoins; log shows `poll timeout exceeded`; JVM GC logs show long stop-the-world pauses.

**Diagnose:**
```bash
# Check GC activity in service logs
docker logs banking-transaction-service --tail 500 \
  | grep -E "GC|pause|poll|timeout|rebalance"

# Check JVM memory pressure
curl -s http://localhost:8082/actuator/metrics/jvm.gc.pause | jq '.measurements'
curl -s http://localhost:8082/actuator/metrics/jvm.memory.used | jq '.measurements'
```

**Fix:**
```bash
# Option 1: Increase max.poll.interval.ms to tolerate GC pauses
# In application.yml:
# spring.kafka.consumer.properties.max.poll.interval.ms=600000  (10 minutes)

# Option 2: Reduce max.poll.records so each poll takes less time
# spring.kafka.consumer.max-poll-records=50  (default is 500)

# Option 3: Tune JVM GC (add to JAVA_OPTS in Docker env)
# -XX:+UseG1GC -XX:MaxGCPauseMillis=200 -Xms512m -Xmx1g

# Apply by restarting service
docker restart banking-transaction-service
```

---

## Scaling Consumers

When lag is persistent and root cause is insufficient throughput (not a bug), scale consumer concurrency.

### Increase Spring Kafka Concurrency

Edit the service's `application.yml` or set via environment variable:

```yaml
# application.yml
spring:
  kafka:
    listener:
      concurrency: 4  # Number of consumer threads per listener container
                      # Should match or be a divisor of partition count
```

```bash
# Via Docker environment variable
docker run -e SPRING_KAFKA_LISTENER_CONCURRENCY=4 banking-transaction-service

# In docker-compose.yml, add under environment:
# SPRING_KAFKA_LISTENER_CONCURRENCY: "4"
```

> **Rule:** `concurrency` must not exceed the number of partitions. Threads beyond partition count sit idle. Set `concurrency = partition_count` for maximum throughput from a single instance.

### Scale Horizontally (Multiple Instances)

```bash
# Docker Compose scale
docker-compose up --scale transaction-service=3 -d

# Kubernetes
kubectl scale deployment transaction-service --replicas=3 -n banking
```

After scaling, verify Kafka rebalances correctly:

```bash
# Within 30 seconds of scaling, each partition should have an assigned consumer
watch -n 5 'kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --describe --group transaction-service-group'
```

---

## Monitoring Commands

### Real-Time Lag Watch

```bash
# Watch consumer lag update every 5 seconds
watch -n 5 'kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --group transaction-service-group \
  | awk "NR==1 || \$6 > 0"'
```

### Prometheus Queries for Lag

```promql
# Current lag per consumer group and topic
kafka_consumer_group_lag{group="transaction-service-group"}

# Total lag across all partitions for a group
sum(kafka_consumer_group_lag{group="transaction-service-group"}) by (topic)

# Rate of lag change (positive = growing, negative = draining)
rate(kafka_consumer_group_lag{group="transaction-service-group"}[5m])

# Alert expression: lag growing for more than 10 minutes
increase(kafka_consumer_group_lag{group="transaction-service-group"}[10m]) > 5000
```

### Kafka Broker Health

```bash
# Check broker is up
kafka-broker-api-versions.sh --bootstrap-server localhost:9092

# List all topics and partition counts
kafka-topics.sh --bootstrap-server localhost:9092 --list

# Check under-replicated partitions (indicates broker health issue)
kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --under-replicated-partitions
```

---

## Recovery Validation

After applying any fix, validate recovery using the following criteria:

### 1. Lag Is Decreasing

```bash
# Run three times, 2 minutes apart. Lag should drop each time.
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --group transaction-service-group \
  | awk 'NR>1 {print $1, $2, $3, "lag:", $6}'
```

### 2. Lag Returns to Zero Within 10 Minutes

For a backlog of 50,000 messages with 4 consumer threads processing ~200 messages/second, expect clearance in approximately **4–5 minutes**.

### 3. Service Health Is Green

```bash
curl -s http://localhost:8082/actuator/health | jq '.status'
# Expected: "UP"
```

### 4. Transaction Success Rate Recovering in Prometheus

```promql
# Should return to > 99% within 5 minutes of lag clearing
sum(rate(transactions_processed_total{status="COMPLETED"}[5m])) /
sum(rate(transactions_processed_total[5m])) * 100
```

### 5. No New DLT Messages

```bash
# Record current DLT offset
kafka-run-class.sh kafka.tools.GetOffsetShell \
  --broker-list localhost:9092 \
  --topic transaction.initiated.DLT \
  --time -1

# Wait 5 minutes, run again — offset should not have increased
```

> **Recovery declared complete** when: lag < 1,000, service health is UP, transaction success rate > 99%, and no new DLT messages for 5 consecutive minutes.

---

## Related Runbooks

- `docs/runbooks/dlq-reprocessing.md` — Replaying messages from Dead Letter Topics
- `docs/runbooks/saga-stuck-recovery.md` — Recovering sagas stalled by Kafka lag
- `docs/runbooks/incident-response.md` — Overall incident response process
- `docs/runbooks/database-failover.md` — PostgreSQL failover (if lag is DB-bottleneck driven)
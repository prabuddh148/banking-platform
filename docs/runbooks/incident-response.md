# Incident Response Runbook

**Banking Platform — On-Call Operations Guide**
Last Updated: 2026-06-15 | Owner: Platform Engineering

---

## Table of Contents

1. [Severity Levels](#severity-levels)
2. [Initial Triage Checklist (First 5 Minutes)](#initial-triage-checklist)
3. [Communication Protocol](#communication-protocol)
4. [War Room Setup](#war-room-setup)
5. [First-Response Actions by Symptom](#first-response-actions-by-symptom)
6. [Post-Incident Process](#post-incident-process)
7. [Incident Timeline Template](#incident-timeline-template)

---

## Severity Levels

| Severity | Definition | Examples | Response SLA | On-Call Response |
|----------|-----------|---------|-------------|-----------------|
| **SEV1** | Production down, data loss risk, or core financial transactions failing | All transactions failing, DB primary down, fraud service refusing all transactions, data corruption detected | Acknowledge in **5 min**, mitigate in **30 min** | IC + Senior Eng + Eng Manager |
| **SEV2** | Degraded performance, partial outage — some users affected, core function available | API Gateway returning 503 for 20% of requests, Kafka consumer lag >50k, notification service down | Acknowledge in **15 min**, mitigate in **2 hours** | IC + On-call Eng |
| **SEV3** | Minor impact, workaround available, single non-critical service degraded | Audit service slow, DLT accumulating but transactions succeeding, dashboard graphs missing | Acknowledge in **1 hour**, fix in **24 hours** | On-call Eng (async) |
| **SEV4** | Cosmetic or monitoring issue — no user impact | Alert threshold mis-tuned, Grafana panel broken, stale metric | Acknowledge in **4 hours**, fix in **next sprint** | Ticket only |

> **SEV1 Escalation Rule:** If SEV1 is not mitigated within 30 minutes, escalate to VP Engineering and consider customer-facing status page update.

---

## Initial Triage Checklist

Run through this checklist in order within the **first 5 minutes** of receiving an alert. Document each result in the war room channel.

### 1. Check All Service Health Endpoints

```bash
# Run all health checks in parallel
for port in 8080 8081 8082 8083 8084 8085; do
  echo "=== Port $port ===" && \
  curl -s --connect-timeout 3 http://localhost:$port/actuator/health | jq '.status' || echo "UNREACHABLE"
done
```

Expected output when healthy:
```
=== Port 8080 ===
"UP"
=== Port 8081 ===
"UP"
```

Service map:
- `8080` → api-gateway
- `8081` → account-service
- `8082` → transaction-service
- `8083` → fraud-service
- `8084` → notification-service
- `8085` → audit-service

### 2. Check Grafana Service Health Dashboard

Open: http://localhost:3000/d/service-health

- Look for red/orange panels (error rate spike, latency spike)
- Check the **Transaction Success Rate** panel — should be > 99%
- Check the **P99 Latency** panel — should be < 2000ms for transaction-service

### 3. Check Kafka Consumer Lag

**Via Kafka UI (fastest):** http://localhost:9090 → Consumer Groups → Sort by "Lag" descending

**Via CLI:**
```bash
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --all-groups \
  | sort -k6 -rn \
  | head -20
```

Thresholds:
- `> 10,000 messages` → Warning
- `> 50,000 messages` → Critical (SEV2 or SEV1 depending on topic)

Critical topics (lag here = SEV1):
- `transaction.initiated`
- `fraud.decision`
- `balance.reserved`

### 4. Check PostgreSQL Connectivity

```bash
# Check from application host
psql -h localhost -U postgres -d account_db -c "SELECT COUNT(*) FROM accounts.accounts;"
psql -h localhost -U postgres -d transaction_db -c "SELECT COUNT(*) FROM transactions.transactions;"

# Check active connections
psql -h localhost -U postgres -c "
  SELECT datname, count(*) as connections, max_conn
  FROM pg_stat_database
  JOIN (SELECT setting::int as max_conn FROM pg_settings WHERE name='max_connections') s ON true
  WHERE datname IN ('account_db','transaction_db')
  GROUP BY datname, max_conn;"
```

> **Connection pool warning:** If connections approach `max_conn - 10`, the application will start getting "connection refused" errors. Default max_connections = 100.

### 5. Check Error Rate in Prometheus

Open: http://localhost:9090

Run these queries:

```promql
# HTTP 5xx error rate per service (last 5 minutes)
sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m])) by (application)

# Transaction failure rate
sum(rate(transactions_processed_total{status="FAILED"}[5m]))

# Kafka consumer lag per group
kafka_consumer_group_lag
```

> **Baseline:** In normal operation, 5xx rate should be < 0.1% and transaction failure rate < 0.5%.

---

## Communication Protocol

### Notification Matrix

| Severity | Notify Immediately | Notify Within 15 min | Customer Notification |
|----------|-------------------|---------------------|----------------------|
| SEV1 | IC, Senior Eng, Eng Manager, CTO | VP Engineering, Customer Success | Yes — after **30 minutes** unresolved via status page |
| SEV2 | IC, On-call Eng | Eng Manager | No (unless external-facing) |
| SEV3 | On-call Eng | Team Slack channel | No |
| SEV4 | Ticket created | — | No |

### Escalation Path

```
On-call Engineer
       ↓ (no progress in 15 min)
Senior Engineer / Tech Lead
       ↓ (no progress in 30 min for SEV1)
Engineering Manager
       ↓ (no progress in 45 min for SEV1)
VP Engineering + CTO
       ↓ (data loss confirmed or > 1 hour for SEV1)
Legal / Compliance team notified
```

### Customer Notification (SEV1 Only)

- Post to status page at **T+30 min** if not mitigated: "We are experiencing issues with our banking platform. Our team is actively investigating."
- Update every **15 minutes** thereafter.
- Post resolution update within **30 minutes** of fix.
- Template: `docs/templates/status-page-update.md`

### Slack Channels

- `#incidents` — all incident activity, automated alerts
- `#incident-{YYYY-MM-DD}` — dedicated war room channel per incident
- `#eng-oncall` — on-call handoffs and low-noise updates

---

## War Room Setup

### Within First 5 Minutes of SEV1/SEV2

1. **Create Slack channel:** `#incident-2026-06-15` (use today's date)
2. **Pin the following to the channel:**
   - Grafana dashboard URL
   - Prometheus URL
   - Kafka UI URL
   - Link to this runbook
3. **Designate roles:**
   - **Incident Commander (IC):** Coordinates response, makes decisions, drives to resolution. Does NOT debug.
   - **Scribe:** Takes timestamped notes of all actions and findings in the channel.
   - **Technical Lead:** Owns the debugging and fix.
   - **Communications Lead:** Manages stakeholder updates (for SEV1).

### IC Responsibilities

- [ ] Open the incident channel
- [ ] Declare severity level
- [ ] Assign scribe and technical lead
- [ ] Maintain a cadence of status updates (every 15 min for SEV1)
- [ ] Call for escalation if needed
- [ ] Declare incident resolved when health checks pass
- [ ] Schedule postmortem within 48 hours

### Scribe Responsibilities

Document every action in `#incident-{date}` with timestamps:
```
[14:32] @alice confirmed transaction-service /actuator/health returning 503
[14:33] @bob checking PostgreSQL connection pool
[14:35] @bob found connection pool exhausted (98/100 connections used)
[14:37] @bob restarting transaction-service to flush stale connections
[14:41] transaction-service health check passing — monitoring for 5 min
[14:46] Error rate returned to baseline. Incident resolved.
```

---

## First-Response Actions by Symptom

### 503 from API Gateway

```bash
# Check api-gateway is up
curl -s http://localhost:8080/actuator/health | jq

# If api-gateway is up, check downstream services
curl -s http://localhost:8081/actuator/health | jq  # account-service
curl -s http://localhost:8082/actuator/health | jq  # transaction-service
curl -s http://localhost:8083/actuator/health | jq  # fraud-service

# Check api-gateway logs for upstream errors
docker logs banking-api-gateway --tail 100 | grep -E "ERROR|WARN|Connection refused"

# Check circuit breaker state (if Resilience4j is configured)
curl -s http://localhost:8080/actuator/health | jq '.components.circuitBreakers'
```

**Likely causes:**
- Downstream service is down → restart the affected service
- Circuit breaker OPEN → wait for half-open state or manually reset
- All services up but 503 still occurring → check api-gateway memory/CPU

### High Kafka Consumer Lag

See full runbook: `docs/runbooks/kafka-consumer-lag.md`

**Quick actions:**
```bash
# Identify lagging consumer group
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --describe --all-groups | awk '$6 > 1000 {print}'

# Check if consumers are alive (EMPTY consumer = stopped)
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --describe --group transaction-service-group

# Restart lagging service
docker restart banking-transaction-service
```

### DB Connection Failures

```bash
# Check pool exhaustion in service logs
docker logs banking-transaction-service --tail 200 | grep -i "connection\|pool\|hikari"

# Check PostgreSQL process count
psql -h localhost -U postgres -c "
  SELECT state, count(*)
  FROM pg_stat_activity
  WHERE datname = 'transaction_db'
  GROUP BY state;"

# Check for long-running blocking queries
psql -h localhost -U postgres -c "
  SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
  FROM pg_stat_activity
  WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes'
    AND datname = 'transaction_db';"

# Kill blocking query if necessary (use with caution)
psql -h localhost -U postgres -c "SELECT pg_cancel_backend({pid});"
```

### Saga Stuck

See full runbook: `docs/runbooks/saga-stuck-recovery.md`

**Quick detection:**
```sql
SELECT transaction_id, current_step, saga_status, created_at, updated_at
FROM transactions.saga_state
WHERE saga_status IN ('STARTED', 'COMPENSATING')
  AND updated_at < NOW() - INTERVAL '30 minutes';
```

### OOM / Pod Crash

```bash
# Check recent pod restarts (Kubernetes)
kubectl get pods -n banking | grep -v "Running\|Completed"
kubectl describe pod {pod-name} -n banking | grep -A5 "OOMKilled\|Reason"

# Check heap usage (if pod is still up)
curl -s http://localhost:{port}/actuator/metrics/jvm.memory.used | jq
curl -s http://localhost:{port}/actuator/metrics/jvm.memory.max | jq

# Get heap dump before restarting (if space allows)
kubectl exec -it {pod-name} -n banking -- \
  jcmd 1 VM.heap_dump /tmp/heapdump-$(date +%s).hprof
kubectl cp {pod-name}:/tmp/heapdump-*.hprof ./heapdump.hprof -n banking

# Increase memory limit (edit deployment)
kubectl edit deployment {service-name} -n banking
# Change: resources.limits.memory from 512Mi to 1024Mi

# For Docker Compose
docker update --memory 1g banking-transaction-service
docker restart banking-transaction-service
```

> **Note:** Always capture a heap dump before restarting a JVM that crashed with OOM. This is essential for root cause analysis.

---

## Post-Incident Process

### Immediately After Resolution

- [ ] Declare incident resolved in `#incident-{date}` with timestamp
- [ ] Update status page (SEV1 only): "This incident has been resolved."
- [ ] Write a 2-sentence summary of what happened and how it was fixed
- [ ] Set reminder to schedule postmortem within 48 hours

### Root Cause Analysis (RCA) — Within 48 Hours

The RCA document must include:
1. **Incident summary** — what broke, for how long, who was affected
2. **Timeline** — all events from first alert to resolution
3. **Root cause** — the actual technical cause (not the symptom)
4. **Contributing factors** — what made this possible or worse
5. **Impact** — estimated transactions affected, error count, financial impact
6. **Resolution** — exact steps taken to fix
7. **Action items** — with owners and due dates

Use template: `docs/templates/rca-template.md`

### Blameless Postmortem

- Schedule within **5 business days** for SEV1/SEV2
- Attendees: IC, technical responders, Eng Manager, QA lead
- Focus on **systems and processes**, never individuals
- Output: action items in Jira with due dates and owners
- Share postmortem doc with entire engineering team

### Action Item Standards

Each action item must have:
- **What:** Specific, implementable task
- **Why:** How it prevents recurrence
- **Who:** Single named owner
- **When:** Due date (SEV1 items due within 2 weeks)
- **Priority:** P0 (blocks recurrence) / P1 (reduces impact) / P2 (improves detection)

---

## Incident Timeline Template

Use this template in the war room Slack channel and copy to the RCA document.

```
## Incident Timeline — {date} {brief description}

Severity: SEV{N}
IC: {name}
Scribe: {name}
Services Affected: {list}
Total Duration: {start} → {end} = {X} minutes

### Timeline

| Time (UTC) | Who | Action / Finding |
|------------|-----|-----------------|
| {HH:MM} | Alert | PagerDuty alert fired: {alert name} |
| {HH:MM} | {name} | Acknowledged alert, opened #incident-{date} |
| {HH:MM} | {name} | Assigned IC: {name}, Scribe: {name} |
| {HH:MM} | {name} | Checked /actuator/health — transaction-service DOWN |
| {HH:MM} | {name} | Found: {specific finding} |
| {HH:MM} | {name} | Action taken: {command or action} |
| {HH:MM} | {name} | Monitoring result of action |
| {HH:MM} | {name} | Services returning to healthy state |
| {HH:MM} | IC | Incident declared RESOLVED |

### Root Cause (brief — expand in RCA)
{one sentence}

### Fix Applied
{one sentence}

### Follow-up Action Items
- [ ] {action} — Owner: {name} — Due: {date}
- [ ] {action} — Owner: {name} — Due: {date}
```

---

## Quick Reference

### Service Ports
| Service | Port | Health URL |
|---------|------|-----------|
| api-gateway | 8080 | http://localhost:8080/actuator/health |
| account-service | 8081 | http://localhost:8081/actuator/health |
| transaction-service | 8082 | http://localhost:8082/actuator/health |
| fraud-service | 8083 | http://localhost:8083/actuator/health |
| notification-service | 8084 | http://localhost:8084/actuator/health |
| audit-service | 8085 | http://localhost:8085/actuator/health |

### Monitoring URLs
| Tool | URL |
|------|-----|
| Grafana | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Kafka UI | http://localhost:9090 |

### Related Runbooks
- `kafka-consumer-lag.md` — High Kafka lag diagnosis and resolution
- `saga-stuck-recovery.md` — Stuck saga state machine recovery
- `outbox-backlog-recovery.md` — Outbox event backlog clearing
- `dlq-reprocessing.md` — Dead letter queue inspection and replay
- `database-failover.md` — PostgreSQL failover procedures

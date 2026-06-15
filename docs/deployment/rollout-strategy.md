# Rollout Strategy

**Applies to**: All Banking Platform services  
**Last Updated**: 2024-02-01  
**Owner**: DevOps / Platform Engineering  
**Related**: `ci-cd-pipeline.md`, `environment-config.md`

---

## Overview

This document defines how changes are deployed to production. The strategy depends on the nature of the change. Not all releases are equal: a bug fix in a single service has a different risk profile than a schema change affecting an event contract between three services.

Using the wrong rollout strategy for a given change is a leading cause of production incidents. Follow this guide to select the appropriate strategy.

---

## Release Types

| Release Type | Definition | Examples |
|---|---|---|
| **Patch** | Bug fix; no new features; no API or schema changes | Fix NPE in fraud rule engine, correct a log message, fix a typo in error response |
| **Minor** | New feature or enhancement; backward-compatible API change; optional new fields only | Add new `/api/v1/accounts/summary` endpoint, add optional `note` field to transfer request |
| **Major** | Breaking change; new API version; schema change that removes or renames fields; changes to Kafka event schema | Remove deprecated `amount` field, change `accountNumber` type from string to object, add mandatory field to `transaction.initiated` event |

When in doubt, classify a release as the higher risk type.

---

## Rollout Strategies

### Patch Release: Rolling Update

**Use when**: Bug fix only; no schema or contract changes.

**Zero downtime**: Yes, when `minReadySeconds` and `maxUnavailable` are configured correctly.

**Procedure**:

1. Merge PR to `main`. CI/CD builds and tags image `{service}:{git-sha}`.
2. Staging deploys automatically. Run smoke tests.
3. Obtain manual approval in GitHub Actions.
4. Kubernetes executes rolling update:
   ```bash
   kubectl set image deployment/{service} {service}=banking-platform/{service}:{git-sha}
   kubectl rollout status deployment/{service} --timeout=300s
   ```
5. Kubernetes replaces pods one by one:
   - Starts 1 new pod
   - Waits for new pod to pass health check (`/actuator/health` → 200)
   - Terminates 1 old pod
   - Repeats until all pods are updated

**Kubernetes deployment configuration** (patch-safe defaults):

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0      # Never reduce capacity below desired replica count
      maxSurge: 1            # Allow 1 extra pod during update
  minReadySeconds: 30        # Wait 30s after pod is Ready before declaring it stable
```

**Expected impact**: Zero downtime. Brief consumer group rebalance in Kafka consumers (see Kafka section below).

---

### Minor Release: Blue/Green Deployment

**Use when**: New feature or backward-compatible API change where you want instant rollback capability.

**Zero downtime**: Yes.

**How it works**: The new version (Green) is deployed alongside the current version (Blue). Traffic is switched atomically from Blue to Green. If Green has issues, traffic switches back to Blue in seconds.

**Procedure**:

1. Deploy the new version (Green) alongside the current version (Blue):
   ```bash
   # Deploy green version (separate deployment, no traffic yet)
   kubectl apply -f k8s/{service}-green-deployment.yaml
   kubectl rollout status deployment/{service}-green --timeout=300s
   ```

2. Verify Green is healthy:
   ```bash
   # Send test traffic to Green via port-forward
   kubectl port-forward deployment/{service}-green 8081:8081
   curl -f http://localhost:8081/actuator/health
   # Run integration smoke tests against Green
   ```

3. Switch traffic from Blue to Green (update the Service selector):
   ```bash
   kubectl patch service {service} \
     -p '{"spec":{"selector":{"version":"green"}}}'
   ```

4. Monitor for 15 minutes (error rate, latency, Kafka consumer lag).

5. If stable: tear down Blue.
   ```bash
   kubectl delete deployment/{service}-blue
   ```

6. If issues: switch traffic back to Blue immediately:
   ```bash
   kubectl patch service {service} \
     -p '{"spec":{"selector":{"version":"blue"}}}'
   ```

**Cost**: Requires 2x pod resources during the switch window. Plan capacity accordingly.

---

### Major Release: Canary Release

**Use when**: Breaking change; new API version; Kafka event schema change; any change with high uncertainty.

**Zero downtime**: Yes.

**How it works**: A small percentage of traffic (5%) is routed to the new version (Canary). If error rates and latency are acceptable, the percentage is gradually increased to 100%. If issues are detected, canary traffic is reduced to 0% before any customer impact is widespread.

**Traffic split schedule**:

| Phase | Canary Traffic | Observation Window | Promotion Criterion |
|---|---|---|---|
| Initial canary | 5% | 30 minutes | Error rate < 0.1%, p99 latency within 20% of baseline |
| Ramp 1 | 25% | 30 minutes | Same criteria |
| Ramp 2 | 50% | 30 minutes | Same criteria |
| Ramp 3 | 100% | 15 minutes | Full traffic; monitor for 15 min |
| Complete | Retire old version | — | Delete old deployment |

**Implementation with Kubernetes Ingress + weighted routing**:

```yaml
# 5% canary traffic via ingress weight annotation
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {service}-canary
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "5"
```

Adjust `canary-weight` at each phase without redeploying pods.

**Stopping a canary**:
```bash
# Set weight to 0 — all traffic goes to stable version
kubectl annotate ingress {service}-canary \
  nginx.ingress.kubernetes.io/canary-weight=0 --overwrite
# Optionally delete canary deployment
kubectl delete deployment {service}-canary
```

---

## Kafka Consumer Rolling Update Considerations

All services that consume Kafka topics experience a **consumer group rebalance** during rolling updates. This is expected behavior but has operational implications:

### What Happens During Rebalance

1. A pod shuts down: its partitions are unassigned.
2. Kafka detects the consumer left (within `session.timeout.ms` = 30s).
3. Kafka triggers a group rebalance: redistributes partitions among remaining consumers.
4. During rebalance, no messages are consumed from affected partitions (processing pauses).
5. New pod starts: joins the consumer group.
6. Kafka rebalances again to include the new pod.

**Result**: A brief processing lag spike during rolling updates. Messages accumulate in Kafka topics and are processed after rebalance completes.

### Impact by Service

| Service | Consumer Topic | Expected Lag Spike | Recovery Time |
|---|---|---|---|
| fraud-service | `transaction.initiated` | Low (< 100 messages) | < 60s |
| transaction-service | `fraud.decision` | Low (< 100 messages) | < 60s |
| notification-service | `notification.requested` | Medium (< 500 messages) | < 120s |
| audit-service | All topics | Medium (< 500 messages) | < 120s |

### Mitigation

- Use **cooperative rebalancing** (`partition.assignment.strategy=CooperativeStickyAssignor`) to minimize partition movement during rebalance. Cooperative rebalancing allows consumers to retain partitions not being reassigned, reducing the rebalance pause duration.
- Monitor `kafka_consumer_lag_records` during rollouts. Alert if lag exceeds 5x the pre-rollout baseline.
- For `fraud-service`, monitor `FRAUD_CHECK_TIMEOUT` rate during rebalance. A lag spike in `transaction.initiated` consumption means fraud checks take longer. The 30-second saga timeout provides buffer; a 60-second rebalance would cause `FRAUD_CHECK_TIMEOUT` compensations.

---

## Database Migration During Rollout

### The N-1 Compatibility Rule

Database migrations must be backward-compatible with the **previous version (N-1)** of the service code. During a rolling update or blue/green deployment, both the old and new versions of a service run simultaneously against the same database schema.

**Scenario**: Service v2 is being deployed. Service v1 pods are still running. Flyway runs the new migration as v2 starts up. Now:
- v2 pods use the new schema
- v1 pods (still running, draining connections) use the new schema too

If the migration removes a column that v1 code reads, v1 pods will throw errors.

### What Is N-1 Compatible?

| Migration Action | N-1 Compatible? | Notes |
|---|---|---|
| Add a new nullable column | Yes | Old code ignores new column |
| Add a new column with DEFAULT | Yes | Old code ignores new column |
| Add a new table | Yes | Old code ignores new table |
| Add a new index | Yes | Transparent to application code |
| Remove a column | **No** | Old code tries to read removed column |
| Rename a column | **No** | Old code uses old name |
| Add a NOT NULL column without default | **No** | Old code doesn't populate the new column |
| Change column type | **No** | Old code may fail to parse new type |
| Drop a table | **No** | Old code tries to query dropped table |

### Two-Phase Migration Pattern for Breaking Schema Changes

Breaking schema changes use a two-phase approach across two release cycles:

**Release N (additive)**: Add new schema elements alongside old ones.
```sql
-- V2__add_new_amount_column.sql
ALTER TABLE transactions ADD COLUMN amount_decimal DECIMAL(19,4);
-- Backfill: UPDATE transactions SET amount_decimal = CAST(amount_string AS DECIMAL(19,4));
```

**Release N+1 (cleanup)**: After v1 is fully retired, remove the old elements.
```sql
-- V3__remove_old_amount_column.sql (only run after old version is fully gone)
ALTER TABLE transactions DROP COLUMN amount_string;
```

---

## Rollback Procedure

### Detection

Issues are detected via:
- **Grafana alert**: Error rate spike above threshold (> 1% of 5xx responses for 2 consecutive minutes)
- **Failed Kubernetes health checks**: Pod `readinessProbe` fails; Kubernetes stops routing traffic to the pod
- **Kafka consumer lag alert**: Lag exceeds 5x baseline for more than 5 minutes
- **Manual detection**: On-call engineer observes anomalous behavior in monitoring

### Rollback Steps

**Step 1: Declare rollback decision** (< 2 minutes after detection)
- On-call engineer opens a Slack incident channel: `#incident-YYYY-MM-DD-{service}`
- Announces rollback is starting
- Notes the current (bad) image tag and the target (previous stable) image tag

**Step 2: Execute rollback** (< 5 minutes)

For rolling update or canary rollback:
```bash
# Get the previous stable image tag from CI/CD run history
PREVIOUS_SHA=abc123def456  # From GitHub Actions run before the bad deploy

kubectl set image deployment/{service} \
  {service}=banking-platform/{service}:${PREVIOUS_SHA}
kubectl rollout status deployment/{service} --timeout=300s
```

For blue/green rollback:
```bash
# Switch service selector back to Blue
kubectl patch service {service} \
  -p '{"spec":{"selector":{"version":"blue"}}}'
```

**Step 3: Verify rollback** (< 10 minutes)
```bash
# Confirm error rate returning to normal
# Check health endpoints
curl -f https://api.bank.com/actuator/health

# Confirm correct image version is running
kubectl get pods -l app={service} -o jsonpath='{.items[*].spec.containers[0].image}'
```

**Step 4: Database migration assessment**

If a Flyway migration ran as part of the bad deployment:
- The migration **cannot be automatically reversed** — Flyway does not support rollback.
- If the migration was additive (added columns/tables): the previous code version is N-1 compatible with the new schema. Rollback proceeds without database changes.
- If the migration was destructive (removed/renamed columns): **you cannot safely roll back to the old code** because it depends on schema that no longer exists. Options:
  a. Apply a compensating forward migration to restore what was removed.
  b. Keep the new code deployed; fix forward.
  c. Restore from database snapshot (data loss from snapshot point onward — last resort).

**Step 5: Post-incident actions**
- Open a GitHub issue: "Post-Incident: {service} rollback on {date}"
- Document: what was deployed, what failed, how it was detected, how it was resolved, and how to prevent recurrence
- Add or update integration test to catch the regression

---

## Go / No-Go Checklist (Pre-Production Deploy)

Complete this checklist before approving a production deployment in the GitHub Actions approval gate:

**Code and Testing**
- [ ] All CI stages passed (build, unit tests, integration tests, static analysis)
- [ ] The PR was reviewed by at least one other engineer
- [ ] No known P0/P1 bugs in the release

**Database**
- [ ] Flyway migration (if any) was tested in staging with the staging dataset
- [ ] Migration has been verified as N-1 compatible (or two-phase pattern was used)
- [ ] Rollback plan for database changes is documented in the release issue

**Deployment**
- [ ] Rollout strategy is selected and matches the release type (patch/minor/major)
- [ ] Previous stable image SHA is noted for rollback reference
- [ ] On-call engineer has been notified and is monitoring

**Monitoring**
- [ ] Grafana dashboards are open and baseline metrics are noted
- [ ] Kafka consumer lag baseline is noted for affected services
- [ ] Error rate and latency baseline are noted
- [ ] Alert channels are unmuted

**Communication**
- [ ] Stakeholders have been notified if user-facing behavior is changing
- [ ] Changelog entry is written

---

## Post-Deploy Validation

After every production deployment, regardless of release type:

**Immediate (< 5 minutes post-deploy)**:
1. Confirm all pods are `Running` and `Ready`:
   ```bash
   kubectl get pods -l app={service}
   ```
2. Hit the health endpoint:
   ```bash
   curl -f https://api.bank.com/actuator/health
   ```
3. Check Grafana: error rate and latency are within 10% of pre-deploy baseline.

**15-Minute Monitoring Window**:
- Keep Grafana open for 15 minutes post-deploy.
- Watch: HTTP 5xx rate, Kafka consumer lag, saga `FRAUD_CHECK_TIMEOUT` rate (if `transaction-service` or `fraud-service` was deployed), JVM heap usage.
- If any metric degrades and does not recover within 5 minutes, execute rollback.

**Smoke Tests** (automated, run by CD pipeline after deploy):
```bash
# Account service: create + read
ACCOUNT_ID=$(curl -sf -X POST https://api.bank.com/api/v1/accounts \
  -H "Authorization: Bearer ${TEST_TOKEN}" \
  -d '{"ownerId":"test-user","accountType":"CHECKING"}' | jq -r .id)
curl -sf https://api.bank.com/api/v1/accounts/${ACCOUNT_ID} | jq .status

# Transaction service: initiate transfer (will complete async)
TX_ID=$(curl -sf -X POST https://api.bank.com/api/v1/transactions/transfer \
  -H "Authorization: Bearer ${TEST_TOKEN}" \
  -d '{"fromAccountId":"...","toAccountId":"...","amount":"1.00","currency":"USD"}' | jq -r .transactionId)
sleep 10
curl -sf https://api.bank.com/api/v1/transactions/${TX_ID} | jq .status
```

---

## Feature Flags

Feature flags are **not currently implemented** in the Banking Platform. This means all code in a deployed version is active for all users simultaneously.

**Recommended future implementation**: LaunchDarkly or Spring Cloud Config for feature flag management. This would enable:
- Progressive rollout of features without Kubernetes canary complexity
- Instant kill switch to disable a feature without redeployment
- A/B testing infrastructure

When feature flags are implemented, this document will be updated to reflect how flag-gated features are rolled out and rolled back.

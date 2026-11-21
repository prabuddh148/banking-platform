# Rollout Strategy

How we release new versions without losing money, events or requests.

## 1. Default: rolling update

Each service runs ≥ 2 instances in staging/production. A deploy replaces instances one by one:

1. Start a new instance. Flyway runs (backward-compatible migrations only).
2. Wait for readiness: `/actuator/health/readiness` = `UP`.
3. Gateway/load balancer starts sending traffic to it.
4. Stop one old instance gracefully (`server.shutdown: graceful`): it finishes in-flight HTTP requests,
   commits its current Kafka offset and stops the outbox relay.
5. Repeat.

Why this is safe:
- **Kafka consumers**: when an instance stops, its partitions are rebalanced to the others. Messages
  that were in progress are redelivered → handled by idempotent consumers.
- **Outbox**: un-sent rows stay `PENDING` in the DB and are sent by the next relay run.
- **Sagas**: state is in the DB, not in memory, so any instance can continue a saga.

## 2. Order of deployment

When a release changes an event or API contract:

1. **Consumers first** — they must accept the new field / ignore unknown fields.
2. **Producers next** — start sending the new field.
3. **Gateway / frontend last** — start using new endpoints.

When only one service changes, only that service is deployed.

## 3. Compatibility rules

- Database: expand → migrate → contract ([migration-strategy](../database/migration-strategy.md)).
- Events: additive changes only within a `schemaVersion`
  ([schema-evolution-policy](../events/schema-evolution-policy.md)).
- REST: additive changes only within `/api/v1` ([api-versioning-policy](../api-contracts/api-versioning-policy.md)).
- `JWT_SECRET` rotation: see [secret-management](../security/secret-management.md) (needs a
  two-key period, otherwise all users are logged out).

## 4. Canary (for risky changes)

For changes to fraud rules or the balance logic:

1. Deploy one new instance next to the old ones (≈ 1 of N partitions / requests).
2. Watch for 30 minutes:
   - error rate (`http_server_requests_seconds_count{status=~"5.."}`),
   - transactions `FAILED` per minute, fraud `REVIEW`/`BLOCK` rate,
   - DLT message count, outbox `FAILED` count, consumer lag.
3. If metrics are normal, continue the rolling update; otherwise roll back.

Fraud rule thresholds are configuration (`fraud.rules.*`), so a threshold change can be rolled out
and reverted without a code change.

## 5. Rollback

| What | How |
|------|-----|
| Application | Redeploy the previous image tag (same procedure as a rollout). |
| Database | Do **not** roll back schema; previous code runs on the new schema (backward compatible). Fix forward. |
| Bad events already published | Consumers of the previous version ignore unknown fields. If events are wrong, publish corrective events — never edit topics. |
| Config | Revert the config change and restart. |

Rollback triggers (any one):
- 5xx rate > 2 % for 5 minutes,
- any balance inconsistency,
- DLT messages growing continuously,
- saga timeouts increasing.

## 6. Maintenance windows

Not needed for normal releases. Needed only for: Postgres major upgrades, Kafka broker upgrades, or a
contract-phase migration on a very large table. Announce at least 48 hours ahead.

## 7. Post-release checklist

- [ ] All instances healthy, versions as expected (`/actuator/info`).
- [ ] Smoke flow passes (login → account → transfer → COMPLETED).
- [ ] No new messages in `*.DLT`.
- [ ] `SELECT status, count(*) FROM outbox_events GROUP BY status;` shows no growing `PENDING`/`FAILED`.
- [ ] Consumer lag back to normal.

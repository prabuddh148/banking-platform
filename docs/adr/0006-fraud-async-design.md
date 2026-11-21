# 0006. Asynchronous, rule-based fraud checks

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

Every deposit, withdrawal and transfer must be screened before money moves. Some transactions are
clearly fine, some are clearly fraud, and some need a human to look at them. A human review can take
minutes or hours, so the check cannot be a blocking HTTP call inside the client's request.

## Decision

- Fraud checks run **asynchronously**. fraud-service consumes `TRANSACTION_INITIATED` from
  `banking.transaction.events`, evaluates rules, stores a `FraudDecision` (and a `FraudAlert` when the
  decision is REVIEW or BLOCK) and publishes `FRAUD_CLEARED` or `FRAUD_DETECTED` to `banking.fraud.events`.
- Rules are simple, explainable and configurable (`fraud.rules.*` in `FraudRulesConfig`):

  | Rule | Condition | Score |
  |------|-----------|-------|
  | AmountThresholdRule | amount > 100,000 / > 500,000 | +40 / +70 |
  | VelocityRule | > 5 transactions for the same account in 10 minutes | +30 |
  | GeographicRule | `clientCountry` present and not in allowed list (`IN`) | +25 |
  | PatternAnomalyRule | amount > 5x average of last 20 decisions (needs >= 3) | +20 |
  | PatternAnomalyRule | between 00:00 and 05:00 IST | +10 |

  The score is capped at 100. Risk level: `< 30 LOW`, `< 60 MEDIUM`, `< 80 HIGH`, else `CRITICAL`.
  Decision: LOW/MEDIUM → `APPROVE`, HIGH → `REVIEW`, CRITICAL → `BLOCK`.
- `REVIEW` puts the transaction in `UNDER_REVIEW` (saga `AWAITING_REVIEW`). An admin decides via
  `POST /api/v1/fraud/alerts/{id}/review`: APPROVE → `FRAUD_CLEARED` (with `reviewedBy`),
  REJECT → `FRAUD_DETECTED` with decision `BLOCK`.
- fraud-service publishes directly with `KafkaTemplate` (no outbox). It is idempotent on
  `transactionId`, so if a publish fails the consumer retries the incoming event and re-publishes.
- An admin-only dry-run endpoint `POST /api/v1/fraud/check` evaluates rules without persisting.

## Consequences

**Positive**
- The client gets `202 Accepted` immediately; slow reviews do not hold HTTP connections.
- fraud-service can be scaled, redeployed or temporarily down without losing transactions (Kafka
  buffers; the saga timeout catches long outages).
- Every decision is stored with its triggered rules — easy to explain to a customer or auditor.

**Negative**
- Velocity and pattern rules use fraud-service's own decision history, which is only as complete as
  the events it has seen.
- Rule-based scoring is easy to evade compared with ML models.
- Without an outbox, a crash between saving the decision and publishing relies on Kafka redelivery of
  the incoming event; the consumer must re-publish for an already-stored decision instead of skipping.

## Alternatives considered

- **Synchronous REST call from transaction-service** — simpler, but couples availability and does not
  fit human review.
- **ML model scoring** — better detection, but needs training data we do not have. The rule interface
  allows adding a model-based rule later.
- **Fraud check inside transaction-service** — fewer services, but mixes concerns and makes the rule
  engine harder to own and tune separately.

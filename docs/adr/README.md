# Architecture Decision Records (ADRs)

An ADR is a short document that records **one** important architecture decision: what problem we had,
what we decided, and what that decision costs us. ADRs are never rewritten after they are accepted —
if a decision changes, a new ADR is added that *supersedes* the old one.

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](0001-use-kafka-for-async.md) | Use Apache Kafka for asynchronous communication | Accepted |
| [0002](0002-saga-orchestration.md) | Orchestrated saga for money movement | Accepted |
| [0003](0003-outbox-pattern.md) | Transactional outbox for reliable event publishing | Accepted |
| [0004](0004-postgresql-per-service.md) | PostgreSQL with one database per service | Accepted |
| [0005](0005-jwt-authentication.md) | JWT authentication: gateway issues, every service re-validates | Accepted |
| [0006](0006-fraud-async-design.md) | Asynchronous, rule-based fraud checks | Accepted |

## Template

```markdown
# NNNN. Title

- **Status:** Proposed | Accepted | Deprecated | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context
What forces are at play? What problem are we solving?

## Decision
What we decided, stated in active voice ("We will ...").

## Consequences
What becomes easier, what becomes harder, and what we must now take care of.

## Alternatives considered
Other options and why they were not chosen.
```

## How to add an ADR

1. Copy the template into `docs/adr/NNNN-short-title.md` using the next free number.
2. Open it with status **Proposed** in a pull request.
3. When the PR is merged, change the status to **Accepted** and add it to the index above.

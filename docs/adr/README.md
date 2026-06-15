# Architecture Decision Records (ADR)

This directory contains Architecture Decision Records for the Banking Platform. ADRs capture significant architectural decisions made during the development of this system, providing future engineers with the reasoning, alternatives considered, and trade-offs accepted at the time each decision was made.

---

## What Is an ADR?

An Architecture Decision Record is a short document that captures a single architectural decision. It records:

- **The context** — what situation or problem forced this decision
- **The decision** — what was chosen and why
- **The consequences** — what results from making this choice (positive and negative)

ADRs are written in the past tense after a decision is made, or in the present tense when a decision is still being evaluated. They are immutable once accepted: if a decision is reversed, the original ADR is marked **Superseded** and a new ADR is written explaining the reversal.

The goal is to give future engineers the ability to understand *why* the system is built the way it is, not just *how* it works.

---

## When to Write an ADR

Write an ADR for any architectural decision that meets one or more of these criteria:

- **Hard to reverse**: the decision creates significant structural inertia (e.g., choice of database, messaging system, authentication mechanism)
- **Broad impact**: the decision affects multiple services or teams
- **Non-obvious**: a reasonable engineer might question why this approach was chosen over an obvious alternative
- **Trade-off accepted**: you are knowingly accepting a downside in exchange for an upside

Do **not** write an ADR for:
- Implementation details within a single service that do not affect other services
- Library version choices (unless the choice is particularly non-standard)
- Routine configuration decisions

---

## ADR Template

When creating a new ADR, copy the following template and fill it in:

```markdown
# ADR-NNNN: Title

**Status**: Proposed | Accepted | Deprecated | Superseded by ADR-XXXX

**Date**: YYYY-MM-DD

**Deciders**: [list of people involved in this decision]

---

## Context

[Describe the situation, forces, and constraints that led to this decision. Include
what problem you were solving and what options you were aware of at the time.]

## Decision

[State the decision clearly. Begin with "We will..." or "We have decided to...".
Explain the reasoning for choosing this option over the alternatives.]

## Consequences

### Positive
- [List the benefits and upsides of this decision]

### Negative
- [List the drawbacks, risks, and trade-offs accepted]

### Neutral
- [List changes that are neither good nor bad but worth noting]

## Alternatives Considered

[For each alternative, briefly state what it is and why it was rejected.]

### Alternative A: [Name]
- **Rejected because**: [reason]

### Alternative B: [Name]
- **Rejected because**: [reason]
```

---

## Status Definitions

| Status | Meaning |
|---|---|
| **Proposed** | The ADR has been written and is under review. A PR is open for discussion. |
| **Accepted** | The decision has been made and is in effect. Do not change the content; write a new ADR if the decision changes. |
| **Deprecated** | The decision is no longer recommended but has not been reversed yet. May be replaced in a future iteration. |
| **Superseded** | The decision has been reversed by a later ADR. The ADR lists which ADR superseded it. |

---

## ADR Index

| Number | Title | Status | Date | Supersedes |
|---|---|---|---|---|
| [ADR-0001](./0001-kafka-async-communication.md) | Use Kafka for Async Communication | Accepted | 2024-01-10 | — |
| [ADR-0002](./0002-orchestration-saga.md) | Orchestration-Based Saga for Distributed Transactions | Accepted | 2024-01-15 | — |
| [ADR-0003](./0003-outbox-pattern.md) | Outbox Pattern for Event Reliability | Accepted | 2024-01-18 | — |
| [ADR-0004](./0004-postgresql-per-service.md) | PostgreSQL Database per Service | Accepted | 2024-01-20 | — |
| [ADR-0005](./0005-jwt-authentication.md) | JWT Authentication at API Gateway | Accepted | 2024-01-22 | — |
| [ADR-0006](./0006-fraud-async-design.md) | Async Fraud Detection via Kafka Saga | Accepted | 2024-02-01 | — |

---

## How to Propose a New ADR

1. **Identify the decision**: Confirm the decision meets the "when to write an ADR" criteria above.

2. **Assign a number**: Take the next available number in sequence. Check this index file to find the current highest number. The next ADR would be `ADR-0007`.

3. **Create the file**: Copy the template above into a new file named `NNNN-short-kebab-case-title.md` in this directory.

4. **Set status to Proposed**: The ADR begins life with `Status: Proposed`.

5. **Open a Pull Request**: The PR title should follow the format `ADR-NNNN: [Title]`. This is where the decision is discussed. Link to any spike documents, benchmarks, or proof-of-concept code that informed the decision.

6. **Discuss in the PR**: All engineers who will be affected by or who have context on the decision should review the PR. Alternatives and concerns should be raised as PR comments. The decider is the author, informed by reviewer input.

7. **Update and finalize**: Incorporate feedback from the discussion. When consensus is reached, update status from `Proposed` to `Accepted` in the same PR.

8. **Merge**: Merge the PR. From this point the ADR is immutable. Update this README's ADR Index table to include the new row.

9. **Superseding an existing ADR**: If the new decision reverses a previous one, set the old ADR's status to `Superseded by ADR-NNNN` (do not edit the body of the old ADR) and reference it in the new ADR's Context section.

---

## Relationship Between ADRs

Some ADRs build on or are enabled by others. Understanding these dependencies helps when evaluating future changes.

```
ADR-0001 (Kafka)
  ├── enables ADR-0002 (Orchestration Saga — uses Kafka for saga events)
  ├── enables ADR-0003 (Outbox Pattern — publishes reliably to Kafka)
  └── enables ADR-0006 (Async Fraud Detection — fraud events over Kafka)

ADR-0004 (Database per Service)
  └── necessitates ADR-0002 (Saga — cross-service SQL transactions not possible)

ADR-0005 (JWT Auth)
  └── independent — scoped to API Gateway boundary only
```

Changing ADR-0001 (replacing Kafka) would require re-evaluating ADR-0002, ADR-0003, and ADR-0006. Changing ADR-0004 (database architecture) would require re-evaluating ADR-0002.

---

## References

- [Documenting Architecture Decisions — Michael Nygard (2011)](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [ADR GitHub Organization](https://adr.github.io/)
- [Lightweight Architecture Decision Records — ThoughtWorks Technology Radar](https://www.thoughtworks.com/radar/techniques/lightweight-architecture-decision-records)

# Compliance Notes

> **Disclaimer:** this is a learning project, not a licensed bank. These notes map platform features
> to the kinds of controls real banking regulations expect, so the design decisions make sense. They
> are not legal advice and do not make the system compliant.

## 1. Relevant frameworks (for context)

| Framework | Area | Typical expectations |
|-----------|------|----------------------|
| RBI Master Directions (IT governance, cyber security, digital payment security) | Indian banks / payment systems | Access control, audit trails, fraud monitoring, incident reporting, data localisation for payment data |
| DPDP Act 2023 (India) | Personal data | Purpose limitation, data minimisation, security safeguards, erasure when no longer needed, breach notification |
| PMLA / KYC-AML rules | Anti-money laundering | Record keeping (≥ 5 years), suspicious transaction monitoring and reporting |
| PCI DSS | Card data | Not in scope — the platform stores no card numbers |
| GDPR | EU personal data | Similar to DPDP if EU customers were served |

## 2. Control mapping

| Control | How the platform supports it | Where |
|---------|------------------------------|-------|
| Strong authentication | JWT from gateway, validated in every service | [security-model](security-model.md) |
| Role-based access & least privilege | `ROLE_CUSTOMER` / `ROLE_ADMIN`, ownership checks | security-model §3 |
| Segregation of duties | Admin actions (freeze, fraud review) recorded with actor id | account status history, fraud alerts |
| Complete audit trail | Every account, transaction and fraud event stored in `audit_logs` | audit-service |
| Tamper-evident logs | `audit_logs` is append-only (triggers block UPDATE/DELETE/TRUNCATE) | `V1__create_audit_schema.sql` |
| Traceability | `correlationId` on events, `X-Trace-Id` on requests | [event-driven-design](../architecture/event-driven-design.md) |
| Transaction monitoring | Rule-based fraud scoring on every transaction, human review queue | fraud-service, [ADR 0006](../adr/0006-fraud-async-design.md) |
| Data integrity of balances | Atomic DB transactions, pessimistic locks, idempotency, `BigDecimal` | [saga-pattern](../architecture/saga-pattern.md) |
| Reliable record keeping | Outbox ensures no lost events | [outbox-pattern](../architecture/outbox-pattern.md) |
| Data minimisation / masking | `MaskingUtil` in audit details & logs; masked recipient in notification API | common-library |
| Retention & erasure | Defined periods, anonymisation approach | [data-retention-policy](../database/data-retention-policy.md) |
| Secret handling | Env vars + secret manager, rotation | [secret-management](secret-management.md) |
| Incident management | Runbooks, severity levels, post-mortems | [runbooks](../runbooks/incident-response.md) |
| Change management | PR review, CI checks, versioned migrations and APIs | [ci-cd-pipeline](../deployment/ci-cd-pipeline.md) |

## 3. Audit log content

Each `audit_logs` row has: `event_id`, `event_type`, `aggregate_id`, `aggregate_type`, `actor`,
`action`, `severity`, `source_service`, `correlation_id`, masked `details`, `occurred_at`,
`recorded_at`.

Severity rules:
- `FRAUD_DETECTED` → CRITICAL when BLOCK, WARNING when REVIEW
- `TRANSACTION_FAILED`, `BALANCE_UPDATE_FAILED`, `ACCOUNT_STATUS_CHANGED` → WARNING
- everything else → INFO

Admins query it via `/api/v1/audit/logs` (filters: event type, aggregate, actor, severity, time
range) and `/api/v1/audit/summary`.

## 4. Gaps before any real-world use

| Gap | Needed |
|-----|--------|
| No KYC / identity verification | Customer onboarding with document checks |
| Demo users in config | Real identity provider, MFA for customers and admins |
| No regulatory reporting | Suspicious transaction reports (STR) and cash transaction reports from fraud/audit data |
| Admin actions on the gateway (e.g. login) not audited | Publish login/security events to the audit log |
| No encryption at rest configured | Encrypted volumes / managed DB encryption, encrypted backups |
| No Kafka auth | SASL/TLS and ACLs |
| Data residency | Host data in the required region (e.g. payment data in India) |
| Penetration testing, vulnerability management | Regular external tests, patch SLAs |
| Business continuity | DR site, tested restores, RPO/RTO targets |

# Compliance Notes

**Platform:** Banking Platform  
**Regulatory Scope:** PCI-DSS (payment card adjacent), GDPR (EU personal data)  
**Last Updated:** 2026-06-15  
**Owner:** Compliance Team / Legal  
**Review Cadence:** Annual (or on material architecture change)

> **Disclaimer:** This document describes the controls implemented within the banking platform and is intended to support compliance assessments. It is not a legal opinion and does not constitute a certification of compliance. A qualified security assessor (QSA) or data protection officer (DPO) must be engaged for formal certifications.

---

## Table of Contents

1. [Regulatory Scope](#1-regulatory-scope)
2. [PCI-DSS Relevant Controls](#2-pci-dss-relevant-controls)
3. [GDPR Relevant Controls](#3-gdpr-relevant-controls)
4. [Audit Trail Requirements](#4-audit-trail-requirements)
5. [Data Residency](#5-data-residency)
6. [Third-Party Data Processors](#6-third-party-data-processors)
7. [Annual Review Checklist](#7-annual-review-checklist)

---

## 1. Regulatory Scope

### 1.1 PCI-DSS

The platform handles account numbers and financial transactions but does not store, process, or transmit primary account numbers (PAN) from payment cards directly. Card-adjacent controls apply because:

- The platform may receive transactions funded by payment cards via payment processors.
- Account numbers (non-card) are stored and must be protected equivalently.
- The platform is subject to audit by banking regulators who reference PCI-DSS as a baseline.

**PCI-DSS applicability level:** The platform is not currently in scope for SAQ-D (which requires a full QSA assessment). The engineering team applies PCI-DSS controls as a due-diligence baseline. If direct card processing is added in future, a full PCI-DSS gap assessment must be completed before go-live.

### 1.2 GDPR

GDPR applies because:
- The platform collects and processes personal data of EU residents (name, email, phone, address, financial transactions).
- The platform stores this data in databases that may reside in EU regions.
- The company is either established in the EU or offers services to EU residents (Art. 3 GDPR).

**Legal basis for processing:**

| Processing Activity | Legal Basis | GDPR Article |
|---|---|---|
| Account management and transactions | Contractual necessity | Art. 6(1)(b) |
| Fraud detection and prevention | Legitimate interest | Art. 6(1)(f) |
| Audit logging for regulatory compliance | Legal obligation | Art. 6(1)(c) |
| Marketing and promotional communications | Consent | Art. 6(1)(a) |
| KYC / identity verification | Legal obligation | Art. 6(1)(c) |

### 1.3 Local Financial Regulations

Depending on the jurisdiction of operation, additional regulations may apply. The following are flagged for legal review before launch in each market:

| Jurisdiction | Regulation | Relevant Requirement | Action Required |
|---|---|---|---|
| United Kingdom | FCA SYSC | Operational resilience, audit trails, record-keeping | Legal review required |
| European Union | EBA Guidelines on ICT | Data security, incident reporting timelines | Legal review required |
| United States | GLBA Safeguards Rule | Data protection program, risk assessment | Legal review required |
| India | RBI IT Framework | Data localisation, audit, outsourcing | Legal review required |

---

## 2. PCI-DSS Relevant Controls

### 2.1 Requirement 3 — Protect Stored Account Data

| Control | PCI-DSS Req. | Implementation | Status |
|---|---|---|---|
| No PANs stored | 3.3 | No payment card PAN fields exist in any database schema | Implemented |
| Account numbers masked in logs | 3.4 | `MaskingUtil.maskAccountNumber()` masks to last 4 digits before any log output | Implemented |
| Account numbers masked in API responses | 3.4 | `AccountDto` exposes `maskedAccountNumber` field only (e.g., `****4321`) | Implemented |
| Encrypted at rest | 3.5 | AWS RDS AES-256 encryption enabled on all PostgreSQL databases | Implemented |
| Data retention limits | 3.1 | Transaction records: 7 years. Inactive account data: per data-retention-policy.md | Partial — see data-retention-policy.md |

**MaskingUtil implementation reference:**

```java
public final class MaskingUtil {

    private MaskingUtil() {}

    // "1234567890123456" -> "************3456"
    public static String maskAccountNumber(String accountNumber) {
        if (accountNumber == null || accountNumber.length() < 4) return "****";
        return "*".repeat(accountNumber.length() - 4)
               + accountNumber.substring(accountNumber.length() - 4);
    }

    // "john.doe@example.com" -> "jo***@example.com"
    public static String maskEmail(String email) {
        if (email == null || !email.contains("@")) return "***@***";
        String[] parts = email.split("@", 2);
        String local = parts[0].length() > 2
            ? parts[0].substring(0, 2) + "***"
            : "***";
        return local + "@" + parts[1];
    }

    // "+447911123456" -> "+44*****3456"
    public static String maskPhone(String phone) {
        if (phone == null || phone.length() < 6) return "****";
        int prefixLength = Math.min(3, phone.length() - 4);
        return phone.substring(0, prefixLength)
               + "*".repeat(phone.length() - prefixLength - 4)
               + phone.substring(phone.length() - 4);
    }
}
```

### 2.2 Requirement 4 — Protect Data in Transit

| Control | PCI-DSS Req. | Implementation | Status |
|---|---|---|---|
| TLS 1.2+ for all external traffic | 4.2.1 | Enforced at API Gateway; HTTP connections rejected with 301 redirect; HSTS header set | Implemented |
| TLS for DB connections | 4.2.1 | `?ssl=true&sslmode=verify-full` in JDBC URL for staging/prod | Implemented |
| No weak cipher suites | 4.2.1 | TLS 1.0 and 1.1 explicitly disabled; RC4, MD5, DES excluded from cipher list | Implemented |
| Internal comms encryption | 4.2.1 | Internal Kafka is plaintext (accepted risk — private network; mTLS planned Q4 2026) | Partial |

### 2.3 Requirement 7 and 8 — Access Control and Identity

| Control | PCI-DSS Req. | Implementation | Status |
|---|---|---|---|
| Unique IDs per user | 8.2 | Each user has a UUID `userId`; no shared credentials permitted | Implemented |
| Role-based least privilege | 7.2 | Six defined roles; each role has minimum required permissions documented in role matrix | Implemented |
| Short-lived authentication tokens | 8.3 | Access tokens expire in 15 minutes | Implemented |
| Strong password requirements | 8.3.6 | Minimum 12 chars, upper + lower + digit + special required; enforced in `PasswordPolicyValidator` | Implemented |
| Account lockout | 8.3.4 | Lockout after 5 failed login attempts; 15-minute lockout period; admin can unlock | Implemented |
| MFA for privileged users | 8.4 | ROLE_ADMIN and ROLE_COMPLIANCE — TOTP-based MFA planned Q3 2026 | Planned |

### 2.4 Requirement 10 — Audit Logging

| Control | PCI-DSS Req. | Implementation | Status |
|---|---|---|---|
| Log all access to account data | 10.2 | `audit_logs` table captures every read and write on account and transaction data | Implemented |
| Log authentication events | 10.2.4 | auth-service logs all login, logout, and token refresh events with outcome | Implemented |
| Log failed access attempts | 10.2.5 | Failed auth and RBAC denials logged with IP address and `X-Correlation-Id` | Implemented |
| Protect log integrity | 10.5 | Logs shipped to CloudWatch Logs (immutable, IAM-controlled); `audit_logs` table is INSERT-only | Implemented |
| Retain logs for 12 months | 10.7 | CloudWatch log group retention: 365 days; `audit_logs` table retained 7 years | Implemented |
| Synchronised timestamps (UTC) | 10.3 | All logs use UTC ISO-8601 timestamps; NTP sync enforced on all EC2 instances via AWS Time Sync Service | Implemented |

### 2.5 Requirement 11 — Security Testing

| Control | PCI-DSS Req. | Implementation | Status |
|---|---|---|---|
| Dependency vulnerability scanning | 11.3 | OWASP Dependency-Check in CI pipeline on every build; HIGH findings fail the build | Implemented |
| Penetration testing | 11.4 | Annual penetration test by external firm required; most recent test date to be recorded here | Required annually |
| Intrusion detection | 11.5 | CloudTrail + CloudWatch alarms for anomalous access patterns | Partial |
| Static application security testing | 11.3 | SpotBugs + FindSecBugs in CI pipeline | Implemented |

---

## 3. GDPR Relevant Controls

### 3.1 Lawful Basis and Transparency

- A Privacy Notice is surfaced to users at registration and is version-controlled in the legal repository.
- The legal basis for each processing activity is documented in the Record of Processing Activities (RoPA) maintained by the DPO.
- Users are informed of their rights (access, rectification, erasure, portability, objection, restriction) within the Privacy Notice.
- A cookie consent mechanism is implemented on any web frontend (out of scope for this API-layer document).

### 3.2 Data Minimization (Art. 5(1)(c))

The platform collects only data required to operate the banking service:

| Data Element | Collected | Justification | Not Collected |
|---|---|---|---|
| Full legal name | Yes | Identity verification, correspondence, KYC | Middle name (unless required by local regulation) |
| Email address | Yes | Account authentication, transaction notifications | Secondary email address |
| Phone number | Yes | SMS alerts, 2FA | Personal fax, secondary phone |
| Date of birth | Yes | KYC / age verification | Time of birth |
| Residential address | Yes | KYC, regulatory correspondence | Historical addresses unless required by KYC regulation |
| National ID number | Only if legally required | KYC regulation in specific markets | Retained for minimum period required by law only |
| Transaction history | Yes | Core banking service — contractual necessity | Third-party transaction data not directly related to accounts |
| Device fingerprint | No | Not collected | N/A |
| Location data | No | Not collected | N/A |

### 3.3 Right to Erasure / Right to Be Forgotten (Art. 17)

**Constraint:** Financial regulations (e.g., AML, tax law) require transaction records to be retained for a minimum of 7 years (varies by jurisdiction). Full erasure of a customer who has made transactions is not legally permissible within that window.

**Anonymization procedure** — applied when a customer requests erasure and no legal retention hold applies, or when the mandatory retention period has expired:

```sql
-- Execute within a DB transaction
-- Log the operation to audit_logs and gdpr_requests BEFORE running

BEGIN;

UPDATE customers
SET
    full_name     = 'ANONYMIZED',
    email         = 'anon_' || SUBSTRING(id::text, 1, 8) || '@deleted.invalid',
    phone         = NULL,
    address_line1 = NULL,
    address_line2 = NULL,
    city          = NULL,
    postal_code   = NULL,
    country       = NULL,
    date_of_birth = NULL,
    national_id   = NULL,
    status        = 'ANONYMIZED',
    anonymized_at = NOW()
WHERE id = :customerId
  AND status != 'ANONYMIZED';  -- Idempotent guard

-- Transaction records are retained but customer link is pseudonymized.
-- The customerId FK remains for audit continuity; PII is no longer recoverable.

INSERT INTO gdpr_requests (customer_id, request_type, requested_at, completed_at, outcome)
VALUES (:customerId, 'ERASURE', :requestedAt, NOW(), 'ANONYMIZED');

COMMIT;
```

**Erasure Request Workflow:**

1. Customer submits request via account settings or email to `privacy@bankingplatform.com`.
2. `GDPR_REQUEST` event created in the `gdpr_requests` table with status `PENDING_REVIEW`.
3. Compliance team reviews within 5 business days: check for active accounts, pending transactions, legal holds, AML/KYC retention obligations.
4. **If no legal hold:** Anonymization procedure executed. Customer notified within 30 days (Art. 12(3) GDPR).
5. **If legal hold applies:** Customer notified of the restriction and the expected hold end date within 30 days.
6. When the hold period expires, the anonymization procedure is executed automatically by a scheduled job.

### 3.4 Right to Access and Data Portability (Art. 15, 20)

- Customers request their data export via `POST /api/customers/me/data-export/request`.
- The export job runs asynchronously and generates a JSON file.
- A secure download link (24-hour expiry, signed S3 URL) is sent to the customer's registered email.
- The export includes: personal details, account information, transaction history, notification history, audit log of the customer's own activity.
- Response time: download link delivered within 48 hours of request; maximum 30 days per GDPR Art. 12(3).

**Export data format:**

```json
{
  "exportGeneratedAt": "2026-06-15T10:00:00Z",
  "customer": {
    "id": "cust_x9y8z7w6",
    "fullName": "Jane Doe",
    "email": "jane.doe@example.com",
    "phone": "+447911123456",
    "createdAt": "2024-03-01T09:00:00Z"
  },
  "accounts": [...],
  "transactions": [...],
  "notifications": [...],
  "auditLog": [...]
}
```

### 3.5 Breach Notification (Art. 33, 34)

Per GDPR Art. 33, personal data breaches must be reported to the supervisory authority within 72 hours of becoming aware.

**Detection triggers:**
- CloudWatch alarm: bulk data access > 1,000 unique customer records accessed in < 10 minutes by a single user or service.
- Unexpected AWS Secrets Manager access from an unrecognised IAM principal.
- Anomalous authentication patterns detected by auth-service rate limiter.
- Security researcher disclosure via `security@bankingplatform.com`.

**Breach response timeline:**

| Hour | Action | Responsible |
|---|---|---|
| 0 | Breach detected; incident commander assigned | On-call engineer |
| 1 | Initial assessment: scope, affected data categories, number of affected individuals | Incident commander + Security lead |
| 4 | Internal legal, DPO, and senior management notified | Incident commander |
| 24 | Preliminary notification sent to supervisory authority if breach is confirmed | DPO |
| 48 | Full forensic investigation report available | Security team |
| 72 | Final notification to supervisory authority with complete details (Art. 33 deadline) | DPO + Legal |
| 72+ | Individual notification to affected data subjects if high risk to their rights and freedoms (Art. 34) | DPO + Comms |

See `incident-response.md` for the complete incident response playbook including communication templates.

### 3.6 Data Processing Records (Art. 30)

The `audit_logs` table serves as a supplementary record for automated processing activities within the Art. 30 Record of Processing Activities (RoPA). The formal RoPA document is maintained by the DPO and references this table.

| `audit_logs` field | Art. 30 RoPA element |
|---|---|
| `service_name` | Name of processing activity and controller/processor identity |
| `action` | Categories of processing operations |
| `resource_type` | Categories of personal data processed |
| `actor_role` | Categories of recipients / who accessed the data |
| `occurred_at` | Timestamp satisfying record-keeping requirements |
| `correlation_id` | Enables reconstruction of multi-step processing chains for investigation |

---

## 4. Audit Trail Requirements

### 4.1 Transaction Audit Table

Every state change to a financial transaction creates an immutable record in `transaction_audit`. This supports regulatory requirements, dispute resolution, and fraud investigation.

```sql
CREATE TABLE transaction_audit (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id   UUID         NOT NULL REFERENCES transactions(id),
    previous_status  VARCHAR(30),
    new_status       VARCHAR(30)  NOT NULL,
    actor_id         VARCHAR(50)  NOT NULL,    -- userId or serviceId
    actor_role       VARCHAR(50)  NOT NULL,
    ip_address       INET,
    correlation_id   VARCHAR(50)  NOT NULL,
    reason           TEXT,
    metadata         JSONB,                    -- Non-PII context (e.g., fraud flag details)
    occurred_at      TIMESTAMPTZ  NOT NULL     DEFAULT NOW()
);

-- Production DB user permissions: INSERT only
REVOKE UPDATE, DELETE ON transaction_audit FROM banking_app_user;
GRANT INSERT ON transaction_audit TO banking_app_user;
```

### 4.2 Cross-Service Audit Log

The `audit_logs` table exists in each service's database and captures all significant access and mutation events.

```sql
CREATE TABLE audit_logs (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name    VARCHAR(50)  NOT NULL,
    actor_id        VARCHAR(50)  NOT NULL,
    actor_role      VARCHAR(50)  NOT NULL,
    action          VARCHAR(100) NOT NULL,   -- e.g. 'ACCOUNT_READ', 'TRANSACTION_CREATE'
    resource_type   VARCHAR(50),
    resource_id     VARCHAR(100),
    ip_address      INET,
    user_agent      TEXT,
    correlation_id  VARCHAR(50),
    outcome         VARCHAR(20)  NOT NULL    CHECK (outcome IN ('SUCCESS','DENIED','ERROR')),
    detail          JSONB,                   -- Non-PII context only
    occurred_at     TIMESTAMPTZ  NOT NULL    DEFAULT NOW()
);

REVOKE UPDATE, DELETE ON audit_logs FROM banking_app_user;
GRANT INSERT ON audit_logs TO banking_app_user;
```

### 4.3 Audit Event Inventory

| Event | Table | Triggered By | Retention |
|---|---|---|---|
| User login | `audit_logs` (auth-service) | Every `/auth/login` request | 7 years |
| Failed login | `audit_logs` (auth-service) | Every failed authentication attempt | 7 years |
| Token refresh | `audit_logs` (auth-service) | Every `/auth/refresh` call | 1 year |
| Account created | `audit_logs` (account-service) | `POST /api/accounts` | 7 years |
| Account updated | `audit_logs` (account-service) | `PUT /api/accounts/{id}` | 7 years |
| Account viewed by staff | `audit_logs` (account-service) | `GET /api/accounts/{id}` by SUPPORT or ADMIN role | 7 years |
| Transaction created | `transaction_audit` + `audit_logs` | `POST /api/transactions` | 7 years |
| Transaction status changed | `transaction_audit` | Any status transition in transaction-service | 7 years |
| Fraud alert reviewed | `audit_logs` (fraud-service) | `PUT /api/fraud/alerts/{id}/status` | 7 years |
| Compliance log accessed | `audit_logs` (applicable service) | `GET /api/audit/logs` by COMPLIANCE or ADMIN | 7 years |
| Customer data export | `audit_logs` (account-service) + `gdpr_requests` | `POST /api/customers/me/data-export/request` | 7 years |
| Customer anonymized | `gdpr_requests` | Erasure procedure execution | Permanently |
| Secret accessed (prod) | AWS CloudTrail | Any `GetSecretValue` call in AWS | 7 years |
| Rate limit breach | CloudWatch Logs | Gateway RateLimitFilter | 1 year |

---

## 5. Data Residency

### 5.1 Requirements

- **EU customers:** All personal data and transaction data must reside within the European Economic Area (EEA). Permitted AWS regions: `eu-west-1` (Ireland), `eu-central-1` (Frankfurt), `eu-west-3` (Paris).
- **US customers:** All personal data and transaction data must reside within the United States. Permitted AWS regions: `us-east-1` (N. Virginia), `us-west-2` (Oregon).
- Cross-region replication is permitted only within the same regulatory zone (e.g., EU primary to EU DR region) and only for disaster recovery purposes.
- Customer data must never be replicated from an EU region to a non-adequate third country without SCCs in place.

### 5.2 Implementation

| Component | EU Deployment | US Deployment |
|---|---|---|
| PostgreSQL (RDS Multi-AZ) | `eu-west-1` primary, `eu-central-1` standby | `us-east-1` primary, `us-west-2` standby |
| Kafka (MSK) | `eu-west-1` | `us-east-1` |
| AWS Secrets Manager | `eu-west-1` | `us-east-1` |
| CloudWatch Logs | `eu-west-1` | `us-east-1` |
| S3 (backups, data exports) | `eu-west-1` with S3 Object Lock (WORM, 7 years) | `us-east-1` with S3 Object Lock |
| Redis (ElastiCache) | `eu-west-1` | `us-east-1` |

**Customer region routing:** The API Gateway routes requests based on the customer's registration region (stored in the JWT `region` claim, set at account creation). EU customers always interact with EU infrastructure; US customers with US infrastructure.

### 5.3 Data Transfer Mechanisms

If any cross-border data transfer is required (e.g., a cross-border transaction between an EU and US account), it must be covered by one of:
- **EU-US Data Privacy Framework adequacy decision** (verify current legal status with legal counsel before relying on this — it has been challenged previously).
- **Standard Contractual Clauses (SCCs)** under GDPR Art. 46(2)(c) — must be incorporated into any relevant data processing agreements.

All cross-border data flows must be documented in the RoPA.

---

## 6. Third-Party Data Processors

Under GDPR Art. 28, all third parties who process personal data on behalf of the platform must have a signed Data Processing Agreement (DPA) in place before data is shared.

| Processor | Data Shared | Purpose | DPA Required | DPA Status | Next Review |
|---|---|---|---|---|---|
| SMTP Provider (e.g., AWS SES, SendGrid) | Email address, notification content | Transactional email delivery | Yes | Must verify and document | Annual |
| SMS Provider (e.g., Twilio, AWS SNS) | Phone number, message content | Transaction alerts, OTP/2FA | Yes | Must verify and document | Annual |
| AWS (cloud infrastructure) | All data stored on AWS services | Cloud infrastructure and managed services | Yes | Covered by AWS DPA (standard terms) | N/A — ongoing |
| Payment Processor (if integrated) | Transaction amounts, account references, counterparty details | Payment processing and settlement | Yes | Must be obtained before integration | Pre-integration |
| KYC / Identity Verification Provider (if integrated) | Name, DOB, national ID, address, document images | Identity verification / AML compliance | Yes | Must be obtained before integration | Pre-integration |

**Processor onboarding checklist** (complete before sharing any personal data with a new processor):

- [ ] Confirm the processor is established in an adequate jurisdiction or SCCs are in place.
- [ ] Complete a Data Protection Impact Assessment (DPIA) if the processing is high-risk (Art. 35).
- [ ] Obtain a signed DPA that meets the Art. 28(3) requirements.
- [ ] Add the processor to this table and update the RoPA.
- [ ] Confirm the processor has appropriate security measures (at minimum: encryption in transit, encryption at rest, access controls, incident notification < 48 hours).
- [ ] Schedule annual review of the DPA and processor's security posture.

---

## 7. Annual Review Checklist

This checklist must be completed annually by the compliance team. Evidence for each item must be documented in the compliance tracker with a date and reviewer signature.

### 7.1 Technical Controls

- [ ] Verify TLS 1.2+ is enforced at the API Gateway — run `nmap --script ssl-enum-ciphers -p 443 <gateway-hostname>` from an external host and confirm no TLS 1.0/1.1 or weak cipher suites are offered.
- [ ] Confirm no PANs or cleartext national IDs are stored in any database column — run schema audit and spot-check data samples.
- [ ] Verify `MaskingUtil` is applied in all log patterns — review production CloudWatch log samples for any unmasked account numbers or email addresses.
- [ ] Confirm `audit_logs` and `transaction_audit` tables have no UPDATE/DELETE permissions for the application DB user — run `\dp audit_logs` in psql.
- [ ] Verify log retention periods match the policy — check CloudWatch log group retention settings and database row counts vs. expected retention window.
- [ ] Confirm all secrets have been rotated within their scheduled period — review the rotation log and Secrets Manager last-rotated timestamps.
- [ ] Run OWASP Dependency-Check against all service POMs and resolve any HIGH or CRITICAL findings before sign-off.
- [ ] Verify account lockout is functioning — test in staging: 6 consecutive failed logins must result in account lockout with a 15-minute hold.
- [ ] Verify data residency: confirm EU customer records are in EU-region databases — query a sample of EU customers and confirm their data row is in the EU RDS instance.

### 7.2 Access Control Review

- [ ] Review all users with `ROLE_ADMIN` — confirm each account is still required and the individual is currently employed. Remove any that are not.
- [ ] Review all users with `ROLE_COMPLIANCE` and `ROLE_FRAUD_ANALYST` — obtain written confirmation from each department head that listed individuals still require this access.
- [ ] Review all AWS IAM roles with access to production Secrets Manager — remove any IAM roles or principals no longer needed.
- [ ] Confirm no developer IAM user or role has direct read access to production RDS databases.
- [ ] Verify developer SSH/bastion access to production VPC has been removed or is time-limited with mandatory approval.

### 7.3 Incident and Breach Review

- [ ] Review all security incidents from the past 12 months — confirm each was properly documented in the incident log with RCA and remediation.
- [ ] Confirm any GDPR personal data breaches were reported to the supervisory authority within 72 hours — cross-reference incident log against any regulatory correspondence.
- [ ] Review and update the incident response runbook (`incident-response.md`) based on lessons learned from any incidents in the past year.
- [ ] Confirm breach notification contact list is current: DPO, legal counsel, supervisory authority contact, relevant regulator contacts.

### 7.4 GDPR Subject Rights

- [ ] Review all data subject access requests (DSARs) received in the past year — confirm each was responded to within 30 calendar days.
- [ ] Review all erasure requests — confirm anonymization procedure was applied correctly where legally permissible; confirm legal hold was communicated where it applied.
- [ ] Verify the Privacy Notice is current and accurately reflects all actual processing activities — compare against the RoPA.
- [ ] Confirm consent records for marketing communications are intact, legible, and retrievable for any given data subject.
- [ ] Confirm data export functionality works end-to-end in staging — trigger an export and verify the download link and content are complete.

### 7.5 Vendor and Third-Party Review

- [ ] Confirm DPAs are in place and current for all active third-party processors listed in section 6.
- [ ] Verify that no new third-party processors were onboarded in the past year without a DPA — check infrastructure change log and procurement records.
- [ ] Confirm an annual penetration test was conducted by an external firm and all HIGH/CRITICAL findings have been remediated.
- [ ] Review the threat model (`threat-model.md`) — update the STRIDE analysis for any architectural changes made in the past year, including new services, new trust boundaries, or new data flows.

### 7.6 Documentation Freshness

The following documents must be reviewed, updated if needed, and signed off annually:

| Document | Owner | Sign-Off Required From | Status |
|---|---|---|---|
| `compliance-notes.md` (this document) | Compliance team | Compliance lead + DPO | [ ] Complete |
| `security-model.md` | Platform Engineering | Security lead | [ ] Complete |
| `threat-model.md` | Platform Engineering | Security lead | [ ] Complete |
| `secret-management.md` | Platform Engineering | Platform Engineering lead | [ ] Complete |
| `data-retention-policy.md` | Legal / Compliance | Legal counsel + DPO | [ ] Complete |
| `incident-response.md` | Security + Legal | Security lead + Legal counsel | [ ] Complete |
| Record of Processing Activities (RoPA) | DPO | DPO | [ ] Complete |

---

*This document is maintained by the Compliance team.*  
*Questions and erasure requests: privacy@bankingplatform.com*  
*Security concerns: security@bankingplatform.com*  
*Next scheduled review: 2027-06-15*

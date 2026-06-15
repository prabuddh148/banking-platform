# Secret Rotation Policy

**Applies to**: All Banking Platform secrets in all environments  
**Classification**: Internal — Security Sensitive  
**Last Updated**: 2024-02-01  
**Owner**: Security Lead / Platform Engineering  
**Review Cadence**: Quarterly, or after any security incident

---

## Overview

This document defines the operational procedures for rotating secrets used by the Banking Platform. It complements the secret management policy (which defines where secrets live) by focusing on *how* to rotate them safely, in what order, and with what verification steps.

Secret rotation must be performed on schedule and immediately when any of the following occur:

- A secret is suspected or confirmed to have been leaked
- An engineer who had access to a secret leaves the organization
- A vendor credential (Twilio, SendGrid) is flagged for suspicious activity
- A penetration test or security audit recommends rotation

---

## Secret Inventory and Rotation Schedule

| Secret | Services Affected | Rotation Frequency | Complexity | Storage |
|---|---|---|---|---|
| `JWT_SECRET` | api-gateway (all auth) | Every 30 days | High (all services affected) | AWS Secrets Manager |
| `DB_PASSWORD` (account-service) | account-service | Every 90 days | Low (single service) | AWS Secrets Manager |
| `DB_PASSWORD` (transaction-service) | transaction-service | Every 90 days | Low (single service) | AWS Secrets Manager |
| `DB_PASSWORD` (fraud-service) | fraud-service | Every 90 days | Low (single service) | AWS Secrets Manager |
| `DB_PASSWORD` (notification-service) | notification-service | Every 90 days | Low (single service) | AWS Secrets Manager |
| `DB_PASSWORD` (audit-service) | audit-service | Every 90 days | Low (single service) | AWS Secrets Manager |
| `MAIL_PASSWORD` (SendGrid) | notification-service | Every 90 days | Low (single service) | AWS Secrets Manager |
| `SMS_API_KEY` (Twilio) | notification-service | Every 90 days | Low (single service) | AWS Secrets Manager |
| Docker Hub token | CI/CD pipeline only | Every 180 days | Low (CI/CD only) | GitHub Actions Secrets |
| SSH deploy key (staging) | CI/CD pipeline only | Every 180 days | Low (CI/CD only) | GitHub Actions Secrets |

---

## Dual-Key Window Requirement

**All secret rotations must maintain a minimum 24-hour dual-key window** where both the old and new secrets are valid simultaneously. This prevents service interruption during rotation of secrets that are validated at runtime (JWT tokens that were issued before rotation are still in circulation for up to their TTL duration).

Exception: Emergency rotation (breach response) compresses the dual-key window to **1 hour** maximum. See the Emergency Rotation section.

---

## Procedure 1: JWT_SECRET Rotation

JWT_SECRET rotation is the most complex operation because:
- The api-gateway uses it to validate all incoming access tokens
- Access tokens issued with the old secret are still in circulation for up to 15 minutes (the access token TTL)
- Any gateway instance must accept tokens signed with either the old or new secret during the transition window

**Estimated time**: 45 minutes (excluding the 24-hour overlap period)  
**Risk level**: High — incorrect execution can lock out all users

### Pre-Rotation Checklist

- [ ] Confirm current staging deployment is healthy (this procedure runs in staging first)
- [ ] Note the current `JWT_SECRET` version in AWS Secrets Manager (for emergency rollback)
- [ ] Notify on-call engineer; plan rotation for low-traffic period (weekday, non-peak hours)
- [ ] Have Grafana authentication dashboard open to monitor auth failure rate in real time
- [ ] Have the rollback procedure documented and ready (restore old secret version)

### Step-by-Step Procedure

**Step 1: Generate the new JWT_SECRET**

```bash
# Generate a cryptographically random 64-character base64 secret
NEW_JWT_SECRET=$(openssl rand -base64 48)
echo "New secret (save this temporarily): ${NEW_JWT_SECRET}"
echo "Length: ${#NEW_JWT_SECRET} chars"
# Verify: must be at least 64 characters
```

**Step 2: Store new secret in AWS Secrets Manager (staging first)**

```bash
# Store the new secret as a NEW VERSION in Secrets Manager
# Do NOT delete the old version yet
aws secretsmanager put-secret-value \
  --secret-id "banking-platform/staging/jwt-secret" \
  --secret-string "${NEW_JWT_SECRET}" \
  --region eu-west-1

# Note the new VersionId
aws secretsmanager describe-secret \
  --secret-id "banking-platform/staging/jwt-secret" \
  --query "VersionIdsToStages"
```

**Step 3: Configure api-gateway to accept BOTH old and new secrets**

The api-gateway must be configured to validate tokens signed with either secret. This requires a dual-secret validation mode. The implementation:

```yaml
# application-staging.yaml (api-gateway)
jwt:
  secrets:
    - ${JWT_SECRET_NEW}    # Primary — new tokens signed with this
    - ${JWT_SECRET_OLD}    # Secondary — old tokens still accepted
  signing-secret: ${JWT_SECRET_NEW}   # New tokens are signed with new secret
```

The `JwtValidationFilter` attempts validation with the primary secret; on failure, it falls back to the secondary secret. This allows existing tokens (signed with old secret) to remain valid during the transition.

Deploy the dual-secret configuration to staging:

```bash
# Inject both secrets into the staging deployment
kubectl set env deployment/api-gateway \
  JWT_SECRET_NEW="${NEW_JWT_SECRET}" \
  JWT_SECRET_OLD="${OLD_JWT_SECRET}"
kubectl rollout status deployment/api-gateway --timeout=120s
```

**Step 4: Verify dual-secret mode is working (staging)**

```bash
# Obtain a token using the current (old) flow — this token is signed with old secret
OLD_TOKEN=$(curl -sf -X POST https://staging.bank.internal/auth/login \
  -d '{"email":"test@example.com","password":"test123"}' | jq -r .accessToken)

# Temporarily force new-secret signing, get a new-secret token
NEW_TOKEN=$(curl -sf -X POST https://staging.bank.internal/auth/login \
  -d '{"email":"test@example.com","password":"test123"}' | jq -r .accessToken)

# Both tokens must work
curl -sf -H "Authorization: Bearer ${OLD_TOKEN}" \
  https://staging.bank.internal/api/v1/accounts/me | jq .id
curl -sf -H "Authorization: Bearer ${NEW_TOKEN}" \
  https://staging.bank.internal/api/v1/accounts/me | jq .id
```

Both requests must return 200. If either returns 401, stop and investigate before proceeding.

**Step 5: Wait 24 hours (dual-key window)**

Wait a minimum of 24 hours. During this period:
- New login sessions receive tokens signed with the new secret
- Existing tokens signed with the old secret (15-minute TTL) expire naturally
- After 24 hours, no tokens signed with the old secret should be in circulation
- Monitor auth failure rate in Grafana. Alert threshold: > 0.5% auth failure rate

**Step 6: Remove old secret from dual-secret configuration**

After the 24-hour window:

```bash
# Remove old secret, keep only new secret
kubectl set env deployment/api-gateway \
  JWT_SECRET="${NEW_JWT_SECRET}" \
  JWT_SECRET_NEW- \
  JWT_SECRET_OLD-
kubectl rollout status deployment/api-gateway --timeout=120s
```

**Step 7: Verify single-secret mode**

```bash
# New tokens must still work
curl -sf -H "Authorization: Bearer ${NEW_TOKEN}" \
  https://staging.bank.internal/api/v1/accounts/me | jq .id

# Old tokens must now be rejected
OLD_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${OLD_TOKEN}" \
  https://staging.bank.internal/api/v1/accounts/me)
echo "Old token response: ${OLD_RESPONSE}"  # Must be 401
```

**Step 8: Repeat for production**

After staging is confirmed working, repeat Steps 1-7 for the production environment (`banking-platform/production/jwt-secret`).

**Step 9: Update AWS Secrets Manager — retire old version**

```bash
# Mark the old secret version as AWSPREVIOUS (not AWSCURRENT)
# AWS Secrets Manager retains previous versions for 30 days automatically
aws secretsmanager update-secret-version-stage \
  --secret-id "banking-platform/production/jwt-secret" \
  --version-stage "AWSPREVIOUS" \
  --move-to-version-id "${OLD_VERSION_ID}"
```

**Step 10: Record in rotation log**

Add an entry to the rotation log (see Rotation Log section).

---

## Procedure 2: Database Password Rotation

Each service's database password can be rotated independently. The procedure is the same for all five services; substitute the service name throughout.

**Estimated time**: 20 minutes  
**Risk level**: Medium — a misconfigured password causes service outage for affected service only

### Step-by-Step Procedure

**Step 1: Generate new password**

```bash
NEW_DB_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | head -c 32)
echo "New password length: ${#NEW_DB_PASSWORD}"
```

**Step 2: Create new PostgreSQL user password (dual credential window)**

AWS RDS supports multiple active credentials. Create a second user with the new password while keeping the old user active:

```sql
-- Connect to the database as the master user
-- For account-service:
ALTER USER account_user_v2 WITH PASSWORD 'NEW_DB_PASSWORD';
-- Grant same permissions as account_user
GRANT CONNECT ON DATABASE account_db TO account_user_v2;
GRANT USAGE ON SCHEMA public TO account_user_v2;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO account_user_v2;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO account_user_v2;
```

Or for a simpler rotation approach using AWS RDS automatic rotation (preferred — see Automated Rotation section), update the password directly:

```bash
aws secretsmanager put-secret-value \
  --secret-id "banking-platform/production/account-service/db-password" \
  --secret-string "${NEW_DB_PASSWORD}"
```

**Step 3: Update the secret in AWS Secrets Manager**

```bash
aws secretsmanager put-secret-value \
  --secret-id "banking-platform/production/account-service/db-password" \
  --secret-string "${NEW_DB_PASSWORD}"
```

**Step 4: Update the database password in PostgreSQL**

```sql
ALTER USER account_user WITH PASSWORD 'NEW_DB_PASSWORD';
```

**Step 5: Rolling restart of the affected service**

HikariCP connection pools hold open connections with the old password. A rolling restart forces the service to re-authenticate with the new password:

```bash
kubectl rollout restart deployment/account-service
kubectl rollout status deployment/account-service --timeout=300s
```

**Step 6: Verify connectivity**

```bash
curl -sf https://api.bank.com/api/v1/accounts/health | jq .status
# Must return "UP"
```

**Step 7: Verify Flyway can still run (next deployment test)**

On the next scheduled deployment to this service, confirm Flyway migrations run without connectivity errors. This validates that the Flyway migration user also has the new credentials.

---

## Procedure 3: MAIL_PASSWORD (SendGrid) Rotation

**Estimated time**: 15 minutes  
**Risk level**: Low — only `notification-service` is affected; emails queue during brief outage

### Step-by-Step Procedure

**Step 1: Log in to SendGrid dashboard**

Navigate to Settings → API Keys → Create New API Key. Name it `banking-platform-production-YYYY-MM`. Set permissions: Mail Send only (principle of least privilege).

**Step 2: Store new API key in AWS Secrets Manager**

```bash
aws secretsmanager put-secret-value \
  --secret-id "banking-platform/production/notification-service/mail-password" \
  --secret-string "SG.{NEW_SENDGRID_API_KEY}"
```

**Step 3: Rolling restart of notification-service**

```bash
kubectl rollout restart deployment/notification-service
kubectl rollout status deployment/notification-service --timeout=300s
```

**Step 4: Send a test email**

Trigger a test notification via the internal test endpoint (admin-only):

```bash
curl -sf -X POST https://api.bank.com/api/v1/notifications/test \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d '{"type":"EMAIL","recipient":"ops-test@bank.com","template":"ROTATION_TEST"}'
```

Confirm the test email is received at the ops-test mailbox.

**Step 5: Revoke old SendGrid API key**

In the SendGrid dashboard: Settings → API Keys → find the old key (by name or creation date) → Revoke.

---

## Procedure 4: SMS_API_KEY (Twilio) Rotation

**Estimated time**: 15 minutes  
**Risk level**: Low — only `notification-service` is affected; SMS queues during brief outage

### Step-by-Step Procedure

**Step 1: Log in to Twilio console**

Navigate to Account → API Keys & Tokens → Create new API key. Name it `banking-platform-production-YYYY-MM`.

**Step 2: Store new key in AWS Secrets Manager**

```bash
aws secretsmanager put-secret-value \
  --secret-id "banking-platform/production/notification-service/sms-api-key" \
  --secret-string "${NEW_TWILIO_API_KEY}"
```

**Step 3: Rolling restart and verification**

Same as MAIL_PASSWORD procedure. Send a test SMS via the test endpoint and confirm receipt.

**Step 4: Revoke old Twilio API key**

In Twilio console: Account → API Keys & Tokens → find old key → Revoke.

---

## Rotation Testing

Before retiring the old secret in any rotation, verify the new secret works:

| Test | Pass Criteria | How to Test |
|---|---|---|
| Service starts with new secret | Health check returns UP within 60s | `curl /actuator/health` |
| Authentication succeeds (JWT) | New tokens are issued and accepted | Login + API call with new token |
| Database queries succeed | Account/transaction data is readable | `GET /api/v1/accounts/me` |
| Email sends successfully | Test email received within 5 minutes | Ops test endpoint |
| SMS sends successfully | Test SMS received within 2 minutes | Ops test endpoint |
| Old secret is rejected | Returns 401 / connection refused | Test with old credential |

The last test (old secret rejection) must be performed **after** the dual-key window closes, confirming the old secret is no longer valid.

---

## Automated Rotation with AWS Secrets Manager

AWS Secrets Manager supports automatic rotation for supported services. Configure automatic rotation to reduce manual toil:

### For Database Passwords (RDS PostgreSQL)

```bash
# Enable automatic rotation every 90 days using the AWS-provided Lambda rotation function
aws secretsmanager rotate-secret \
  --secret-id "banking-platform/production/account-service/db-password" \
  --rotation-rules AutomaticallyAfterDays=90 \
  --rotation-lambda-arn "arn:aws:lambda:eu-west-1:123456789:function:SecretsManagerRDSPostgreSQLRotationSingleUser"
```

The AWS Lambda rotation function:
1. Generates a new password
2. Updates the RDS user's password
3. Tests the new credentials
4. Marks the new version as `AWSCURRENT`

Services using the AWS SDK to fetch credentials from Secrets Manager will pick up the new password on the next secret fetch (via `GetSecretValue`). HikariCP must be configured to re-fetch credentials on connection failure.

### For JWT_SECRET

Automated rotation is **not available** for JWT_SECRET because the dual-key window logic is custom (not supported by the standard Lambda rotation function). JWT_SECRET rotation must follow the manual procedure in Procedure 1.

To receive a reminder: create a scheduled CloudWatch Event that fires 5 days before the 30-day rotation deadline and sends an SNS notification to the security Slack channel.

```bash
aws events put-rule \
  --name "JWTSecretRotationReminder" \
  --schedule-expression "rate(30 days)" \
  --state ENABLED
```

---

## Rotation Log

Every secret rotation must be recorded. Append an entry to this section after each rotation. This provides an audit trail for security reviews and compliance audits.

| Date | Secret | Environment | Rotated By | Reason | Notes |
|---|---|---|---|---|---|
| 2024-02-01 | JWT_SECRET | staging + production | Platform Team | Scheduled 30-day rotation | First rotation. Dual-key window: 24h. No auth failures observed. |
| (next rotation due) | JWT_SECRET | staging + production | — | Scheduled | Due: 2024-03-02 |

For sensitive operations (breach response), record in the `audit_logs` database table in addition to this file:

```sql
INSERT INTO audit_logs (event_type, actor, resource, action, details, created_at)
VALUES (
  'SECRET_ROTATION',
  'security-lead@bank.com',
  'JWT_SECRET',
  'ROTATED',
  '{"reason": "scheduled", "environment": "production", "duration_hours": 25}',
  NOW()
);
```

---

## Emergency Rotation (Breach Response)

If a secret is confirmed or suspected to be compromised, compress the rotation timeline to **1 hour maximum**. The dual-key window is reduced from 24 hours to 15 minutes (equal to the JWT access token TTL).

### Emergency Timeline

| Time | Action |
|---|---|
| T+0 | Breach detected. Declare incident. Open `#incident-{date}-secret-breach` in Slack. |
| T+5 | Security Lead confirms breach scope. Which secrets? Which environments? |
| T+10 | Generate all new secrets. Store in Secrets Manager. |
| T+15 | Deploy dual-key configuration to production (accept old + new). |
| T+20 | Verify new secret works (abbreviated test: login + one API call). |
| T+30 | Switch production to new secret only (eliminate old). |
| T+35 | Verify old credentials are rejected in production. |
| T+40 | Revoke old vendor credentials (SendGrid, Twilio) in their dashboards. |
| T+45 | Notify affected users if JWT tokens may have been compromised (all active sessions invalidated). |
| T+60 | Post-incident report drafted. Root cause investigation begins. |

### JWT Breach: Force-Invalidate All Active Sessions

In a JWT_SECRET breach, all currently issued access tokens are potentially compromised. Even after rotating the secret (new tokens work, old tokens rejected), users with tokens issued before the breach may have their tokens stolen.

Response: Add all `jti` values issued in the past 15 minutes to the blocklist table. This is the maximum active access token window. Refresh tokens (7-day TTL) must also be invalidated by clearing the `refresh_token` table for all users and forcing re-login.

```sql
-- Force all users to re-authenticate immediately
TRUNCATE TABLE refresh_tokens;
-- Log the forced invalidation
INSERT INTO audit_logs (event_type, actor, resource, action, details, created_at)
VALUES ('EMERGENCY_SESSION_INVALIDATION', 'security-incident-response', 
        'ALL_SESSIONS', 'INVALIDATED', '{"reason":"jwt_secret_breach","incident":"#incident-2024-XX"}', NOW());
```

### Post-Emergency Actions

1. Full security audit of all systems that had access to the compromised secret
2. Review of CI/CD pipeline logs for secret exposure (accidental log printing)
3. Update the rotation log with the emergency rotation details
4. Revise detection mechanisms to catch breaches sooner
5. Review and tighten access controls on AWS Secrets Manager policies

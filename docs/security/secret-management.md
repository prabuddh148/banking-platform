# Secrets Management Guide

**Platform:** Banking Platform  
**Environments:** Development · Staging · Production  
**Last Updated:** 2026-06-15  
**Owner:** Platform Engineering / Security

---

## Table of Contents

1. [Secret Inventory](#1-secret-inventory)
2. [Environment-Specific Storage](#2-environment-specific-storage)
3. [How Spring Services Read Secrets](#3-how-spring-services-read-secrets)
4. [Secret Rotation Procedures](#4-secret-rotation-procedures)
5. [Git Hygiene and .gitignore Rules](#5-git-hygiene-and-gitignore-rules)
6. [Emergency Secret Compromise Procedure](#6-emergency-secret-compromise-procedure)
7. [Vault / KMS Key Hierarchy](#7-vault--kms-key-hierarchy)
8. [Audit and Access Control](#8-audit-and-access-control)

---

## 1. Secret Inventory

Every secret used by the platform is catalogued below. Any new secret must be added to this table before it is introduced to any environment.

| Secret Name | Type | Used By | Rotation Period | Dev Storage | Staging Storage | Prod Storage |
|---|---|---|---|---|---|---|
| `DB_PASSWORD_ACCOUNT` | DB credential | account-service | 90 days | `.env` | AWS Secrets Manager | AWS Secrets Manager + auto-rotate Lambda |
| `DB_PASSWORD_TRANSACTION` | DB credential | transaction-service | 90 days | `.env` | AWS Secrets Manager | AWS Secrets Manager + auto-rotate Lambda |
| `DB_PASSWORD_FRAUD` | DB credential | fraud-service | 90 days | `.env` | AWS Secrets Manager | AWS Secrets Manager + auto-rotate Lambda |
| `DB_PASSWORD_NOTIFICATION` | DB credential | notification-service | 90 days | `.env` | AWS Secrets Manager | AWS Secrets Manager + auto-rotate Lambda |
| `DB_PASSWORD_AUTH` | DB credential | auth-service | 90 days | `.env` | AWS Secrets Manager | AWS Secrets Manager + auto-rotate Lambda |
| `JWT_SECRET` | Signing key | All services (validation) + auth-service (signing) | 30 days | `.env` | AWS Secrets Manager | AWS Secrets Manager |
| `SERVICE_CLIENT_SECRET_ACCOUNT` | Service token signing | account-service, transaction-service | 60 days | `.env` | AWS Secrets Manager | AWS Secrets Manager |
| `SERVICE_CLIENT_SECRET_TRANSACTION` | Service token signing | transaction-service, fraud-service | 60 days | `.env` | AWS Secrets Manager | AWS Secrets Manager |
| `SERVICE_CLIENT_SECRET_FRAUD` | Service token signing | fraud-service, notification-service | 60 days | `.env` | AWS Secrets Manager | AWS Secrets Manager |
| `MAIL_PASSWORD` | SMTP credential | notification-service | 180 days | `.env` | AWS Secrets Manager | AWS Secrets Manager |
| `SMS_API_KEY` | SMS provider API key | notification-service | 180 days | `.env` | AWS Secrets Manager | AWS Secrets Manager |
| `REDIS_PASSWORD` | Cache credential | API Gateway, auth-service | 90 days | `.env` | AWS Secrets Manager | AWS Secrets Manager |
| `KAFKA_SASL_PASSWORD` | Kafka credential | All services | 90 days | N/A (no auth in dev) | N/A | AWS Secrets Manager (Q4 2026) |

### Secret Classification

| Classification | Examples | Handling |
|---|---|---|
| **Critical** | `JWT_SECRET`, DB passwords | Least-privilege access, mandatory rotation, access logging |
| **High** | Service client secrets, Redis password | Rotation required, access logging |
| **Medium** | Mail password, SMS API key | Rotation required, vendor notification on compromise |

---

## 2. Environment-Specific Storage

### 2.1 Development

**Storage:** `.env` file at the project root of each service.

```bash
# account-service/.env  (example -- never commit this file)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=account_db
DB_USERNAME=account_user
DB_PASSWORD=dev_local_password_not_real

JWT_SECRET=dev-only-jwt-secret-min-32-chars-long-replace-in-prod

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=devredis
```

**Docker Compose secrets** (for local multi-service dev):

```yaml
# docker-compose.yml
services:
  account-service:
    env_file:
      - ./account-service/.env
    # Never use environment: block for secrets in compose files committed to git
```

**Rules for development secrets:**
- `.env` files are in `.gitignore` — verify before every commit.
- Use placeholder values in `.env.example` files committed to the repo.
- Dev `JWT_SECRET` must be different from staging and production values.
- Do not reuse production secrets in development — even on a developer's local machine.

### 2.2 Staging

**Storage:** AWS Secrets Manager in the staging AWS account.

- Path prefix: `/banking-platform/staging/<secret-name>`
- IAM role: `staging-service-role` — only `secretsmanager:GetSecretValue` on staging paths
- No cross-environment IAM permissions allowed
- Staging secrets are manually rotated on the same schedule as production

**Example secret paths:**

```
/banking-platform/staging/jwt-secret
/banking-platform/staging/account-service/db-password
/banking-platform/staging/notification-service/mail-password
/banking-platform/staging/notification-service/sms-api-key
```

### 2.3 Production

**Storage:** AWS Secrets Manager in the production AWS account with automatic rotation enabled for database credentials.

- Path prefix: `/banking-platform/prod/<secret-name>`
- IAM role: `prod-<service-name>-role` — scoped to only the secrets that specific service needs
- Automatic rotation: enabled for all DB passwords via AWS-managed Lambda rotation function
- `JWT_SECRET` rotation is manual (see section 4.1 below — requires coordinated deployment)
- All secret access is logged to AWS CloudTrail

**Example IAM policy for account-service in production:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": [
        "arn:aws:secretsmanager:us-east-1:123456789:secret:/banking-platform/prod/account-service/db-password-*",
        "arn:aws:secretsmanager:us-east-1:123456789:secret:/banking-platform/prod/jwt-secret-*"
      ]
    }
  ]
}
```

**Principle of least privilege:** Each service's IAM role grants access only to the secrets it directly needs. Cross-service secret access is not permitted.

---

## 3. How Spring Services Read Secrets

### 3.1 Development — Spring Dotenv

```xml
<!-- pom.xml -->
<dependency>
    <groupId>me.paulschwarz</groupId>
    <artifactId>spring-dotenv</artifactId>
    <version>4.0.0</version>
</dependency>
```

```yaml
# application.yml (committed -- no secret values)
spring:
  datasource:
    url: jdbc:postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
jwt:
  secret: ${JWT_SECRET}
```

### 3.2 Staging/Production — Spring Cloud AWS Secrets Manager

```xml
<!-- pom.xml -->
<dependency>
    <groupId>io.awspring.cloud</groupId>
    <artifactId>spring-cloud-aws-starter-secrets-manager</artifactId>
    <version>3.1.1</version>
</dependency>
```

```yaml
# application-staging.yml / application-prod.yml
spring:
  config:
    import: >
      aws-secretsmanager:/banking-platform/${SPRING_PROFILES_ACTIVE}/account-service/db-password,
      aws-secretsmanager:/banking-platform/${SPRING_PROFILES_ACTIVE}/jwt-secret
  cloud:
    aws:
      secretsmanager:
        enabled: true
      region:
        static: us-east-1
```

The Spring Cloud AWS integration maps JSON fields from Secrets Manager directly to Spring properties:

```json
// Secret value stored at /banking-platform/prod/account-service/db-password
{
  "spring.datasource.password": "actual_prod_password_here",
  "spring.datasource.username": "account_prod_user"
}
```

### 3.3 Secret Caching and Reload

Spring Cloud AWS caches secrets to reduce Secrets Manager API calls (charged per 10,000 calls).

```yaml
spring:
  cloud:
    aws:
      secretsmanager:
        reload:
          strategy: restart_context   # Restart app context on detected secret change
          period: 60000               # Poll every 60 seconds in staging
          # Set to 3600000 (1 hour) in prod for DB passwords
          # Set to 300000 (5 minutes) in prod for JWT_SECRET during rotation window
```

**Caution:** During `JWT_SECRET` rotation, temporarily reduce the cache TTL so services pick up the new secret promptly. See section 4.1 for the full procedure.

---

## 4. Secret Rotation Procedures

### 4.1 JWT_SECRET Rotation (Full Procedure)

The `JWT_SECRET` is shared by all services for token validation. Rotation requires a coordinated dual-key window to avoid invalidating in-flight tokens.

**Step 1 — Generate the new secret**

```bash
# Generate a cryptographically secure 256-bit (32 byte) secret
openssl rand -base64 32
# Save the output securely in a password manager before proceeding
```

**Step 2 — Store both secrets in Secrets Manager as a dual-key object**

Update the secret to carry both values simultaneously:

```json
{
  "JWT_SECRET_CURRENT": "existing_secret_value_here",
  "JWT_SECRET_NEXT":    "new_secret_value_generated_in_step_1"
}
```

**Step 3 — Deploy dual-key validation to all services**

Update `JwtService` to attempt validation with `JWT_SECRET_NEXT` first, fall back to `JWT_SECRET_CURRENT`:

```java
public Claims parseToken(String token) {
    // Try new key first (tokens signed with new key will validate here)
    try {
        return Jwts.parser()
            .verifyWith(Keys.hmacShaKeyFor(
                Base64.getDecoder().decode(jwtSecretNext)))
            .build()
            .parseSignedClaims(token)
            .getPayload();
    } catch (SignatureException e) {
        // Fall back to old key for tokens issued before rotation
        return Jwts.parser()
            .verifyWith(Keys.hmacShaKeyFor(
                Base64.getDecoder().decode(jwtSecretCurrent)))
            .build()
            .parseSignedClaims(token)
            .getPayload();
    }
}
```

Deploy this version to all 5 services and the gateway before proceeding to step 4.

**Step 4 — Switch signing to the new key**

Update `auth-service` to sign new access tokens with `JWT_SECRET_NEXT`. Existing tokens signed with `JWT_SECRET_CURRENT` remain valid during their TTL (max 15 minutes for access tokens).

**Step 5 — Wait for old access token TTL to expire**

- **Access tokens:** Wait 15 minutes. After 15 minutes, no valid access tokens exist that were signed with the old key.
- **Refresh tokens:** Either wait 7 days for natural expiry, or force-expire all refresh tokens by truncating the `refresh_tokens` table (this forces all users to re-authenticate — appropriate for security incidents only).

**Step 6 — Remove the old key from Secrets Manager**

Update the secret to the final single-key state:

```json
{
  "JWT_SECRET_CURRENT": "new_secret_value_from_step_1"
}
```

Remove the `JWT_SECRET_NEXT` field entirely.

**Step 7 — Revert to single-key validation**

Remove the fallback `catch (SignatureException)` block from `JwtService`. Deploy to all services.

**Step 8 — Document the rotation**

Record the rotation event in the security audit log: timestamp, operator identity, reason (scheduled / incident), and confirmation that old tokens are no longer valid.

---

### 4.2 Database Password Rotation

AWS Secrets Manager automatic rotation handles this transparently via a Lambda rotation function. The Lambda executes a four-step rotation:

1. **createSecret** — Generate a new password and store it as `AWSPENDING` in Secrets Manager.
2. **setSecret** — Set the new password on the PostgreSQL user: `ALTER USER account_user PASSWORD 'new_password';`
3. **testSecret** — Verify the new password works by opening a test DB connection.
4. **finishSecret** — Move the secret from `AWSPENDING` to `AWSCURRENT`.

Spring Cloud AWS picks up the new value within the cache TTL. HikariCP connection pool automatically reconnects failed connections with the new credentials from the refreshed secret.

**Required Lambda permissions:**

```json
{
  "Action": [
    "secretsmanager:DescribeSecret",
    "secretsmanager:GetSecretValue",
    "secretsmanager:PutSecretValue",
    "secretsmanager:UpdateSecretVersionStage"
  ]
}
```

---

### 4.3 Service Client Secret Rotation

Follow the same dual-key procedure as JWT_SECRET but scoped to the two services involved in each service pair. Both services must be deployed within the same release window:

1. Deploy the calling service with support for both old and new `SERVICE_CLIENT_SECRET`.
2. Deploy the receiving service with support for validating tokens signed with either secret.
3. Update Secrets Manager to new secret only.
4. Deploy final version of both services (single-secret validation).

---

### 4.4 Rotation Schedule and Calendar

| Secret | Next Rotation Due | Responsible |
|---|---|---|
| `JWT_SECRET` | 30-day cycle from last rotation | Platform Engineering |
| All `DB_PASSWORD_*` | Automatic (AWS Lambda) | AWS / Platform Engineering monitors |
| All `SERVICE_CLIENT_SECRET_*` | 60-day cycle | Platform Engineering |
| `MAIL_PASSWORD` | 180-day cycle | Platform Engineering + Notification team |
| `SMS_API_KEY` | 180-day cycle | Platform Engineering + Notification team |
| `REDIS_PASSWORD` | 90-day cycle | Platform Engineering |

---

## 5. Git Hygiene and .gitignore Rules

Every service repository must include the following in `.gitignore`:

```gitignore
# Secret files -- NEVER commit these
.env
.env.*
!.env.example

# Certificate and key files
*.pem
*.key
*.p12
*.jks
*.pfx
*.crt
*.cer

# Spring production configuration (contains secret references)
application-prod.yml
application-prod.yaml
application-production.yml
application-staging.yml
bootstrap-prod.yml

# AWS credentials
.aws/credentials
credentials.json

# Terraform state (may contain secret values)
terraform.tfstate
terraform.tfstate.backup
*.tfvars
!*.tfvars.example
```

**Pre-commit hook** (install at `.git/hooks/pre-commit`, make executable with `chmod +x`):

```bash
#!/bin/sh
# Block accidental commit of secret files
if git diff --cached --name-only | grep -qE '\.(env|pem|key|p12|jks)$'; then
  echo "ERROR: Attempting to commit a file that may contain secrets."
  echo "Remove the file from staging: git restore --staged <file>"
  exit 1
fi

# Warn on patterns that look like hardcoded secrets in diff content
if git diff --cached | grep -qiE '(password|secret|api.?key|private.?key)\s*[:=]\s*[^$\{<]'; then
  echo "WARNING: Staged diff may contain a hardcoded secret."
  echo "Review your changes carefully. If this is a false positive, proceed manually."
  exit 1
fi
```

**Committed to repository (safe placeholder file):**

```bash
# account-service/.env.example (committed -- no real values)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=account_db
DB_USERNAME=account_user
DB_PASSWORD=REPLACE_WITH_LOCAL_DEV_PASSWORD

JWT_SECRET=REPLACE_WITH_MIN_32_CHAR_RANDOM_STRING_FROM_openssl_rand_base64_32

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=REPLACE_WITH_LOCAL_DEV_REDIS_PASSWORD
```

**CI/CD secret scanning:** The CI pipeline runs `truffleHog` or `git-secrets` on every pull request to detect accidentally committed secrets. Any scan failure blocks merge.

---

## 6. Emergency Secret Compromise Procedure

Use this procedure when a secret is believed to have been exposed (e.g., accidentally committed to git, observed in public logs, reported by a security researcher).

### Immediate Actions (within 30 minutes of discovery)

**Step 1 — Assess scope.** Determine which environments are affected and what the secret provides access to.

**Step 2 — Rotate immediately.** Do not wait for a scheduled rotation window.

```bash
# Generate new secret
openssl rand -base64 32

# Update in AWS Secrets Manager immediately
aws secretsmanager put-secret-value \
  --secret-id /banking-platform/prod/jwt-secret \
  --secret-string '{"JWT_SECRET_CURRENT":"NEW_VALUE","JWT_SECRET_NEXT":"OLD_COMPROMISED_VALUE"}'
```

**Step 3 — For JWT_SECRET compromise: invalidate all sessions immediately.**

```sql
-- Execute on auth-service database in the affected environment
-- This forces all active users to re-authenticate
TRUNCATE TABLE refresh_tokens;
```

Then force a rolling restart of all services to pick up the new secret from Secrets Manager.

**Step 4 — Revoke all tokens signed with the compromised key.** Since access tokens have a 15-minute TTL, they expire naturally. If the compromise is severe, add the signing key fingerprint to a blocklist and reject all tokens that cannot be validated with the new key (effectively a hard logout for all users).

**Step 5 — Revoke compromised infrastructure access.** If a developer machine or CI/CD system was the source, rotate all credentials that system had access to (not just the one that was leaked).

---

### Investigation Actions (within 2 hours)

**Step 6 — Check git history for the leak.** If found in a public repository:

```bash
# Remove the file from all git history
git filter-repo --path .env --invert-paths
git push --force origin main  # Coordinate with team first
```

Check GitHub/GitLab Secret Scanning alerts — they may have already notified you.

**Step 7 — Audit CloudTrail for unauthorized use.**

```bash
# Look for GetSecretValue calls from unexpected principals or IPs
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=GetSecretValue \
  --start-time 2026-06-01T00:00:00Z \
  --end-time 2026-06-15T23:59:59Z
```

**Step 8 — Escalate.** Notify the security lead and legal/compliance. If customer data was accessed, begin breach notification per `incident-response.md`.

---

### Post-Incident Actions

**Step 9 — Document.** Record timeline, root cause, remediation steps, and affected systems in the incident log.

**Step 10 — Update defenses.** Add the specific leak pattern to the CI secret scanner ruleset. Update the pre-commit hook if needed.

**Step 11 — Review rotation schedule.** If the compromise was due to a rotation period being too long, shorten it.

---

## 7. Vault / KMS Key Hierarchy

### Production Key Hierarchy (AWS KMS)

```
AWS KMS Customer Master Key (CMK)
  Key alias: alias/banking-platform-prod-master
  Purpose: Envelope encryption of all data keys
  Rotation: Automatic annual rotation (AWS-managed)
  Access: Only prod-secrets-admin IAM role
  |
  +-- Data Key: database-encryption-key
  |   Used by: RDS encryption (AES-256 at rest)
  |   Managed by: AWS RDS automatically via KMS integration
  |
  +-- Data Key: secrets-manager-encryption-key
  |   Used by: AWS Secrets Manager to encrypt all stored secrets
  |   Managed by: AWS Secrets Manager automatically
  |
  +-- Data Key: application-field-encryption-key  [PLANNED Q2 2027]
      Used by: Field-level PII encryption at the application layer
      Rotation: 90-day via key version aliases
      Access: Each service's IAM role for its own data key only
```

### HashiCorp Vault (Alternative Configuration)

If Vault is used instead of AWS Secrets Manager, the hierarchy maps as follows:

```
Vault Root Token (offline -- stored in HSM or split with Shamir)
  |
  +-- Vault Unseal Keys (Shamir: 5 shards, 3 required to unseal)
      Stored with 5 different authorized personnel (geographically distributed)
      |
      +-- AppRole Auth per service
          Role: banking-platform-<service-name>
          Policy: read /secret/banking-platform/prod/<service-name>/*
          Token TTL: 1 hour (services re-authenticate automatically via Spring Vault)
```

**Spring Vault integration:**

```xml
<dependency>
    <groupId>org.springframework.vault</groupId>
    <artifactId>spring-vault-core</artifactId>
    <version>3.1.2</version>
</dependency>
```

```yaml
spring:
  cloud:
    vault:
      host: vault.internal.bankingplatform.com
      port: 8200
      scheme: https
      authentication: APPROLE
      app-role:
        role-id: ${VAULT_ROLE_ID}       # From environment (non-secret ID)
        secret-id: ${VAULT_SECRET_ID}   # Injected by CI/CD at deploy time; short-lived
```

**Secret paths in Vault:**

```
/secret/banking-platform/prod/jwt-secret
/secret/banking-platform/prod/account-service/db-password
/secret/banking-platform/prod/notification-service/mail-password
/secret/banking-platform/prod/notification-service/sms-api-key
```

---

## 8. Audit and Access Control

### Who Can Access Secrets

| Role | Development | Staging | Production |
|---|---|---|---|
| Developer | Own `.env` only | Read (via AWS SSO, time-limited session) | No access |
| Platform Engineer | Own `.env` | Read + Write | Read-only (break-glass for write) |
| Security Lead | Own `.env` | Full access | Full access with mandatory MFA |
| CI/CD Pipeline | N/A | Read-only for deploy-time secrets | Read-only for deploy-time secrets |
| Application (runtime) | Read own `.env` | Read own secrets via IAM role | Read own secrets via IAM role |

### Access Logging and Alerting

All reads of production secrets in AWS Secrets Manager are logged to AWS CloudTrail. A CloudWatch alarm fires when:
- Any production secret is read from outside the expected service IAM role ARN.
- More than 100 `GetSecretValue` calls per minute are made (may indicate secret enumeration).
- A secret is accessed from a region other than the designated data region.
- A secret is accessed during non-business hours by a human operator (developer/platform engineer).

**Monthly review:** The security lead reviews CloudTrail logs for all production secret accesses and confirms no anomalies. Findings are documented in the monthly security review log.

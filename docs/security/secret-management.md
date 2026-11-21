# Secret Management

## 1. Secrets in this platform

| Secret | Used by | Env var | Local default |
|--------|---------|---------|---------------|
| JWT signing key | api-gateway + all services (must be identical) | `JWT_SECRET` | `change-me-dev-secret-key-at-least-32-bytes-long` |
| Postgres password | all servlet services, Postgres container | `DB_PASSWORD` (`POSTGRES_PASSWORD` for the container) | `banking` |
| SMTP credentials (if a real SMTP server is used) | notification-service | Spring `spring.mail.username/password` | none (MailHog) |
| Grafana admin password | Grafana | `GRAFANA_ADMIN_PASSWORD` | `admin` |
| Demo user passwords | api-gateway (`gateway.auth.users`) | config | `password`, `admin123` |
| Container registry / deploy credentials | CI | GitHub Actions secrets | – |

All local defaults are **public** (they are in the repo). They are for local development only.

## 2. Rules

1. **Never commit real secrets.** Code and `application.yml` contain only `${VAR:dev-default}`.
2. **Local overrides** go into `docker/.env` (git-ignored; copy from `docker/.env.example` if present)
   or your shell environment.
3. **Non-local environments** read secrets from a secret manager (e.g. AWS Secrets Manager, Azure Key
   Vault, HashiCorp Vault, Kubernetes Secrets with encryption at rest) and inject them as env vars.
4. **Never log secrets.** Don't log the `Authorization` header or full tokens. The gateway request
   log records method, path, status and duration only.
5. **Least privilege**: each service should have its own DB user with rights only on its own
   database in production (locally all use `banking`).
6. **CI** scans every PR for secrets (gitleaks) and blocks the merge on a finding.
7. Services in non-dev profiles should **refuse to start** if `JWT_SECRET` equals the dev default or
   is shorter than 32 bytes (recommended hardening).

## 3. Generating values

```bash
# JWT secret: 64 random bytes, base64 (> 32 bytes as required by HMAC-SHA)
openssl rand -base64 64 | tr -d '\n'

# DB password
openssl rand -base64 24
```

## 4. Rotation

### JWT_SECRET

Changing the secret immediately invalidates all issued tokens (every user must log in again). For a
planned rotation without logout, support two keys for one token lifetime:

1. Add support for a list of verification keys (current + previous) in `JwtTokenValidator`; sign only
   with the current key.
2. Deploy services with `current = new`, `previous = old` (services first, gateway last).
3. Wait at least `JWT_EXPIRY` (1 h) so all old tokens expire.
4. Remove the old key.

Until multi-key support exists, rotate during a quiet period and accept that users are logged out.
In an emergency (secret leaked), rotate immediately — forced logout is the desired effect.

### Database password

1. Create the new password (or a second user) in Postgres.
2. Update the secret in the secret manager.
3. Rolling restart of services so they reconnect with the new credentials.
4. Revoke the old password.

### Schedule

| Secret | Rotate |
|--------|--------|
| JWT secret | Every 90 days or on suspicion |
| DB passwords | Every 90 days or when someone with access leaves |
| CI tokens | Every 180 days |

## 5. If a secret leaks

1. Rotate it immediately (above).
2. Find where it leaked (git history, logs, screenshots). If it was committed, rotating is mandatory —
   rewriting git history alone is not enough.
3. Check the audit log and gateway logs for misuse in the exposure window.
4. Follow [incident-response](../runbooks/incident-response.md).

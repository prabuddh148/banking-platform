# Secret rotation policy

Which secrets the platform uses, where they live, how often they change and how
to rotate them without downtime.

## 1. Inventory

| Secret | Env var(s) | Used by | Rotation interval | Notes |
|---|---|---|---|---|
| JWT signing key | `JWT_SECRET` | api-gateway (sign) + all services (verify) | 90 days, and immediately on suspected leak | ≥ 32 random bytes |
| Database credentials | `DB_USERNAME`, `DB_PASSWORD` (`POSTGRES_USER`/`POSTGRES_PASSWORD` in docker) | all JPA services | 90 days | one DB user per service in production |
| Redis password | (`spring.data.redis.password`) | services using Redis | 180 days | none locally |
| SMTP credentials | (`spring.mail.username/password`) | notification-service | 180 days | none locally (MailHog) |
| Kafka credentials | (SASL config) | all services | 180 days | plaintext locally |
| Grafana admin | `GRAFANA_ADMIN_PASSWORD` | Grafana | 180 days | |

Local values in `docker/.env.example` and `docker/*/*.env` are **public dev
defaults**. They must never be used in any shared environment.

## 2. Storage rules

- Never commit real secrets. `.env` is git-ignored; only `.env.example` with dummy
  values is committed.
- Shared environments read secrets from a secret manager (Vault, AWS Secrets Manager,
  Kubernetes Secrets with encryption at rest) and inject them as environment variables.
- Secrets are never printed in logs, error messages, actuator `/env` output or
  Docker image layers (don't `ARG`/`ENV` them in Dockerfiles).
- Access to production secrets is limited to the deploy pipeline and on-call
  engineers, and every read is audited.

## 3. How to generate

```bash
# JWT key (48 random bytes, base64)
openssl rand -base64 48
# DB / Redis / SMTP password
openssl rand -base64 32 | tr -d '/+=' | cut -c1-32
```

## 4. Rotation procedures

### 4.1 JWT signing key

The current implementation verifies with a single key, so rotation logs everyone out
once (acceptable with 15-minute tokens).

1. Generate a new key and store it in the secret manager as the new version.
2. Roll out **all services first, then the gateway** in one deployment window
   (services verify, the gateway signs). Tokens signed with the old key are
   rejected with `401 INVALID_TOKEN`; clients log in again.
3. Confirm login + a protected call work; watch the 401 rate on the
   *Service Health* dashboard for ~15 minutes.
4. Delete the old key version.

Zero-downtime upgrade path (future): support a list of verification keys
(`JWT_SECRET` + `JWT_SECRET_PREVIOUS`) with a `kid` header — deploy verify-both,
switch signing, wait one token lifetime, remove the old key.

### 4.2 Database password

1. Create the new password on the DB user (or a second user with the same grants):
   `ALTER ROLE account_svc WITH PASSWORD '<new>';` — with the two-user approach no
   running connection breaks.
2. Update the secret and restart the service instances one at a time (rolling
   restart; HikariCP opens new connections with the new password).
3. Check `hikaricp_connections_active` and the error rate; then drop / lock the old
   user or password.

### 4.3 Other credentials (Redis, SMTP, Kafka, Grafana)

Same pattern: add the new credential next to the old one where the system allows
it → roll the clients → verify → remove the old one.

## 5. Emergency rotation (suspected leak)

1. Rotate the affected secret **immediately** using the procedure above; for
   `JWT_SECRET` accept that all sessions are invalidated.
2. Review audit-service logs (`GET /api/v1/audit/logs?from=...`) and gateway access
   logs for activity with the leaked credential.
3. Follow `docs/runbooks/incident-response.md` and record the incident.

## 6. Verification checklist after every rotation

- [ ] `/actuator/health` is UP for every service
- [ ] login + one call per service succeeds through the gateway
- [ ] no rise in 401 / 5xx on the *Service Health* dashboard
- [ ] old secret version removed / disabled
- [ ] rotation date recorded (next due date = date + interval)

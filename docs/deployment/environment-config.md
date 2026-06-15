# Environment Configuration Reference

**Applies to**: All Banking Platform services  
**Last Updated**: 2024-01-22  
**Owner**: DevOps / Platform Engineering

---

## Overview

The Banking Platform runs in four environments. This document is the authoritative reference for all environment-specific configuration variables. Values marked `[SECRET]` must never be committed to source control and must be stored in the appropriate secret management system for each environment.

| Environment | Purpose | Deployment Method | Secret Store |
|---|---|---|---|
| `local-dev` | Individual developer workstation | Docker Compose or native Java | `.env` file (gitignored) |
| `docker-dev` | Fully containerized local development | Docker Compose | `.env` file (gitignored) |
| `staging` | Pre-production integration testing | Docker Compose on staging server | Environment variables set by CI/CD |
| `production` | Live customer-facing system | Kubernetes / AWS ECS | AWS Secrets Manager → injected at startup |

---

## Spring Profiles

Each environment maps to a Spring profile that activates environment-specific `application-{profile}.yaml` files:

| Environment | Spring Profile | How to Activate |
|---|---|---|
| `local-dev` | `default` (no profile needed) | Run without `SPRING_PROFILES_ACTIVE` |
| `docker-dev` | `docker` | `SPRING_PROFILES_ACTIVE=docker` in docker-compose.yml |
| `staging` | `staging` | `SPRING_PROFILES_ACTIVE=staging` in CI deploy step |
| `production` | `production` | `SPRING_PROFILES_ACTIVE=production` in container startup |

Example Spring Boot profile activation in `docker-compose.yml`:

```yaml
environment:
  - SPRING_PROFILES_ACTIVE=docker
```

Example for Kubernetes:

```yaml
env:
  - name: SPRING_PROFILES_ACTIVE
    value: "production"
```

---

## Database Configuration

Each service has its own database. The variables below follow the `account-service` as the example; replace `account` with the service name (`transaction`, `fraud`, `notification`, `audit`) for other services.

### Database Variables (per service)

| Variable | local-dev | docker-dev | staging | production |
|---|---|---|---|---|
| `DB_HOST` | `localhost` | `postgres-account` | `staging-account-db.internal` | `prod-account-db.rds.amazonaws.com` |
| `DB_PORT` | `5432` | `5432` | `5432` | `5432` |
| `DB_NAME` | `account_db` | `account_db` | `account_db` | `account_db` |
| `DB_USERNAME` | `account_user` | `account_user` | `account_user` | `account_user` |
| `DB_PASSWORD` | `dev_password` [SECRET] | `dev_password` [SECRET] | `[SECRET]` | `[SECRET]` |
| `DB_POOL_SIZE` | `5` | `5` | `10` | `20` |
| `DB_POOL_MIN_IDLE` | `2` | `2` | `5` | `10` |
| `DB_CONNECTION_TIMEOUT_MS` | `30000` | `30000` | `10000` | `5000` |

### Database Port Mapping (local-dev only)

In local-dev, each service's PostgreSQL container is exposed on a distinct host port to avoid conflicts:

| Service | Container Name | Host Port | Container Port |
|---|---|---|---|
| account-service | `postgres-account` | `5432` | `5432` |
| transaction-service | `postgres-transaction` | `5433` | `5432` |
| fraud-service | `postgres-fraud` | `5434` | `5432` |
| notification-service | `postgres-notification` | `5435` | `5432` |
| audit-service | `postgres-audit` | `5436` | `5432` |

In `docker-dev`, services communicate over the Docker network using container names (e.g., `postgres-account:5432`). Host port mapping is only needed when connecting from the host machine (e.g., with a database GUI tool).

### Spring Data Source Configuration

```yaml
# application.yaml (uses environment variables)
spring:
  datasource:
    url: jdbc:postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
    hikari:
      maximum-pool-size: ${DB_POOL_SIZE:10}
      minimum-idle: ${DB_POOL_MIN_IDLE:5}
      connection-timeout: ${DB_CONNECTION_TIMEOUT_MS:30000}
  flyway:
    enabled: true
    locations: classpath:db/migration
    baseline-on-migrate: false
```

---

## Kafka Configuration

| Variable | local-dev | docker-dev | staging | production |
|---|---|---|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | `localhost:9092` | `kafka:29092` | `staging-kafka.internal:9092` | `prod-kafka-cluster.internal:9092` |
| `KAFKA_GROUP_ID` | `{service}-cg` | `{service}-cg` | `{service}-cg` | `{service}-cg` |
| `KAFKA_AUTO_OFFSET_RESET` | `earliest` | `earliest` | `latest` | `latest` |
| `KAFKA_ENABLE_AUTO_COMMIT` | `false` | `false` | `false` | `false` |
| `KAFKA_MAX_POLL_RECORDS` | `100` | `100` | `500` | `500` |
| `KAFKA_SESSION_TIMEOUT_MS` | `30000` | `30000` | `30000` | `30000` |
| `KAFKA_PARTITIONS` | `3` | `3` | `6` | `12` |
| `KAFKA_REPLICATION_FACTOR` | `1` | `1` | `2` | `3` |

In `docker-dev`, Kafka is exposed on two ports: `9092` (for external host access) and `29092` (for inter-container communication). Services in docker-compose use `kafka:29092`.

---

## JWT / Authentication Configuration

| Variable | local-dev | docker-dev | staging | production |
|---|---|---|---|---|
| `JWT_SECRET` | `dev-secret-min-32-chars-here!!` [SECRET] | `dev-secret-min-32-chars-here!!` [SECRET] | `[SECRET — min 64 chars]` | `[SECRET — min 64 chars, from Secrets Manager]` |
| `JWT_ACCESS_TOKEN_TTL_MINUTES` | `60` | `60` | `30` | `15` |
| `JWT_REFRESH_TOKEN_TTL_DAYS` | `30` | `30` | `14` | `7` |
| `JWT_ISSUER` | `banking-platform-dev` | `banking-platform-dev` | `banking-platform-staging` | `banking-platform` |

**Secret length requirements**:
- `local-dev` / `docker-dev`: minimum 32 characters (development only; use a static known value for team consistency)
- `staging` / `production`: minimum 64 characters, generated with `openssl rand -base64 48`

**TTL rationale**: Access token TTL is longer in local-dev (60 min) to reduce friction during development. Production uses 15 minutes per security policy (ADR-0005).

---

## Fraud Detection Rule Thresholds

The fraud rule engine uses environment-specific thresholds. Development uses lower thresholds to make it easy to trigger fraud rejection for testing without using large amounts.

| Variable | local-dev | docker-dev | staging | production |
|---|---|---|---|---|
| `FRAUD_MAX_SINGLE_TRANSFER_AMOUNT` | `100.00` | `100.00` | `10000.00` | `50000.00` |
| `FRAUD_VELOCITY_WINDOW_MINUTES` | `5` | `5` | `10` | `15` |
| `FRAUD_VELOCITY_MAX_TRANSFERS` | `3` | `3` | `10` | `20` |
| `FRAUD_BLOCKLIST_CHECK_ENABLED` | `false` | `false` | `true` | `true` |
| `FRAUD_EVALUATION_TIMEOUT_MS` | `5000` | `5000` | `15000` | `25000` |
| `FRAUD_SAGA_TIMEOUT_SECONDS` | `30` | `30` | `30` | `30` |

**Testing tip for local-dev**: Set `FRAUD_MAX_SINGLE_TRANSFER_AMOUNT=50.00` and attempt a transfer of `$75.00` to trigger a `FRAUD_REJECTED` response for testing the rejection flow.

---

## Observability Configuration

### OpenTelemetry (OTel)

| Variable | local-dev | docker-dev | staging | production |
|---|---|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | `http://otel-collector:4318` | `http://staging-otel:4318` | `http://prod-otel-collector:4318` |
| `OTEL_TRACES_SAMPLER` | `always_on` | `always_on` | `traceidratio` | `traceidratio` |
| `OTEL_TRACES_SAMPLER_ARG` | `1.0` | `1.0` | `0.5` | `0.1` |
| `OTEL_SERVICE_NAME` | `{service-name}` | `{service-name}` | `{service-name}` | `{service-name}` |
| `OTEL_RESOURCE_ATTRIBUTES` | `env=local` | `env=docker` | `env=staging` | `env=production` |

**Sampling rate rationale**:
- `local-dev` / `docker-dev`: 100% sampling (`1.0`) — capture every trace for debugging
- `staging`: 50% (`0.5`) — representative sample without storage overhead
- `production`: 10% (`0.1`) — sufficient for latency analysis; reduces Jaeger storage cost

### Prometheus

| Variable | local-dev | docker-dev | staging | production |
|---|---|---|---|---|
| `MANAGEMENT_ENDPOINTS_WEB_EXPOSURE` | `health,info,metrics,prometheus` | `health,info,metrics,prometheus` | `health,metrics,prometheus` | `health,prometheus` |
| `MANAGEMENT_SERVER_PORT` | `8090` | `8090` | `8090` | `8090` |
| `METRICS_EXPORT_ENABLED` | `true` | `true` | `true` | `true` |

Prometheus scrapes metrics from `http://{service}:8090/actuator/prometheus` every 15 seconds. The management port (`8090`) is separate from the application port to prevent accidental exposure via the API gateway.

### Grafana

| Variable | local-dev | docker-dev | staging | production |
|---|---|---|---|---|
| `GRAFANA_ADMIN_USER` | `admin` | `admin` | `admin` | `[SECRET]` |
| `GRAFANA_ADMIN_PASSWORD` | `admin` | `admin` | `[SECRET]` | `[SECRET]` |
| `GRAFANA_URL` | `http://localhost:3000` | `http://grafana:3000` | `https://staging-grafana.internal` | `https://grafana.internal` |

---

## Notification Service Configuration

| Variable | local-dev | docker-dev | staging | production |
|---|---|---|---|---|
| `MAIL_HOST` | `localhost` (Mailhog) | `mailhog` | `smtp.staging.internal` | `smtp.sendgrid.net` |
| `MAIL_PORT` | `1025` | `1025` | `587` | `587` |
| `MAIL_USERNAME` | `test@bank.local` | `test@bank.local` | `[SECRET]` | `[SECRET]` |
| `MAIL_PASSWORD` | (none) | (none) | `[SECRET]` | `[SECRET]` |
| `MAIL_FROM` | `noreply@bank-local.dev` | `noreply@bank-local.dev` | `noreply@staging.bank.com` | `noreply@bank.com` |
| `SMS_API_KEY` | `test-key` | `test-key` | `[SECRET]` | `[SECRET]` |
| `SMS_PROVIDER` | `stub` | `stub` | `twilio` | `twilio` |

In `local-dev` and `docker-dev`, Mailhog runs at `localhost:8025` (web UI) and captures all outbound email without delivering it. SMS uses a stub provider that logs to the console.

---

## How to Configure Each Environment

### local-dev: `.env` file

Create a `.env` file in the project root (already in `.gitignore`). Copy `.env.example` as a starting point:

```bash
cp .env.example .env
# Edit .env with your local values
```

Docker Compose automatically loads `.env` from the project root. For running services natively (not in Docker), export variables manually:

```bash
export $(cat .env | xargs)
mvn spring-boot:run -pl account-service
```

### docker-dev: docker-compose.yml `env_file`

The `docker-compose.yml` references the `.env` file via `env_file`:

```yaml
services:
  account-service:
    env_file:
      - .env
    environment:
      - SPRING_PROFILES_ACTIVE=docker
```

### staging and production: CI/CD secret injection

Secrets are stored in GitHub Actions Secrets (or equivalent CI/CD secret store) and injected as environment variables during the deploy step. See `docs/deployment/ci-cd-pipeline.md` for the full pipeline configuration.

For Kubernetes deployments:
- Non-sensitive values: `ConfigMap`
- Sensitive values: `Secret` (base64-encoded), sourced from AWS Secrets Manager via the AWS Secrets and Configuration Provider (ASCP) sidecar.

---

## Variable Validation on Startup

All services use `@ConfigurationProperties` with `@Validated` to fail fast on startup if required variables are missing or invalid:

```java
@ConfigurationProperties(prefix = "app")
@Validated
public class AppProperties {

    @NotBlank(message = "JWT secret must be configured")
    @Size(min = 32, message = "JWT secret must be at least 32 characters")
    private String jwtSecret;

    @Positive(message = "Access token TTL must be positive")
    private int accessTokenTtlMinutes;

    @NotBlank(message = "Kafka bootstrap servers must be configured")
    private String kafkaBootstrapServers;
}
```

If a required variable is missing, the service refuses to start and logs a clear error message identifying which variable is absent. This prevents silent misconfiguration in deployed environments.

---

## Secrets That Must Never Appear in Source Control

The following variables must never be committed to any repository, even development values:

- `DB_PASSWORD` (any environment)
- `JWT_SECRET` (any environment)
- `MAIL_PASSWORD` (any environment)
- `SMS_API_KEY` (any environment)
- `GRAFANA_ADMIN_PASSWORD` (staging and production)

The `.env.example` file provides placeholder values and documentation but contains no real secrets:

```bash
# .env.example — copy to .env and fill in real values
JWT_SECRET=REPLACE_WITH_MIN_32_CHAR_RANDOM_STRING
DB_PASSWORD=REPLACE_WITH_DATABASE_PASSWORD
```

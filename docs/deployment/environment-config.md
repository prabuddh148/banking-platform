# Environment Configuration

All services read their configuration from **environment variables with safe local defaults**, so
`mvn spring-boot:run` works with zero setup and Docker/Kubernetes only override what differs.

Example from `application.yml`:

```yaml
spring:
  datasource:
    url: jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_NAME:accounts_db}
    username: ${DB_USERNAME:banking}
    password: ${DB_PASSWORD:banking}
  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP_SERVERS:localhost:9092}
jwt:
  secret: ${JWT_SECRET:change-me-dev-secret-key-at-least-32-bytes-long}
  expiry: ${JWT_EXPIRY:PT1H}
```

## 1. Shared variables (all servlet services)

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | Postgres host (`postgres` inside docker-compose) |
| `DB_PORT` | `5432` | Postgres port |
| `DB_NAME` | per service (below) | Database name |
| `DB_USERNAME` | `banking` | DB user |
| `DB_PASSWORD` | `banking` | DB password — **secret** |
| `KAFKA_BOOTSTRAP_SERVERS` | `localhost:9092` | Kafka brokers (`kafka:29092` — the internal listener — inside docker-compose) |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `JWT_SECRET` | `change-me-dev-secret-key-at-least-32-bytes-long` | HMAC key, ≥ 32 bytes, **must be identical in gateway and all services** — **secret** |
| `JWT_EXPIRY` | `PT1H` | Token lifetime (ISO-8601 duration) |
| `TRACING_ENABLED` | `false` | Enables Micrometer tracing export (`management.tracing.enabled`) |
| `SPRING_PROFILES_ACTIVE` | (none) | `dev` for verbose local logging |
| `SERVER_PORT` | service port | Standard Spring Boot override |

## 2. Per service

### api-gateway (8080)

| Variable | Default | Description |
|----------|---------|-------------|
| `ACCOUNT_SERVICE_URL` | `http://localhost:8081` | Route target for `/api/v1/accounts/**` |
| `TRANSACTION_SERVICE_URL` | `http://localhost:8082` | `/api/v1/transactions/**` |
| `FRAUD_SERVICE_URL` | `http://localhost:8083` | `/api/v1/fraud/**` |
| `NOTIFICATION_SERVICE_URL` | `http://localhost:8084` | `/api/v1/notifications/**` |
| `AUDIT_SERVICE_URL` | `http://localhost:8085` | `/api/v1/audit/**` |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | Allowed browser origins |
| `JWT_SECRET`, `JWT_EXPIRY` | as above | Token signing |

Demo users are configured under `gateway.auth.users` in `application.yml`.

### account-service (8081)

| Variable / property | Default | Description |
|---------------------|---------|-------------|
| `DB_NAME` | `accounts_db` | |
| `outbox.relay.interval-ms` | `2000` | Outbox relay delay between runs |

### transaction-service (8082)

| Variable / property | Default | Description |
|---------------------|---------|-------------|
| `DB_NAME` | `transactions_db` | |
| `outbox.relay.interval-ms` | `2000` | Outbox relay delay |
| `saga.timeout-minutes` | `15` | Sagas in AWAITING_FRAUD_CHECK / AWAITING_BALANCE_UPDATE older than this fail |

### fraud-service (8083)

| Variable / property | Default | Description |
|---------------------|---------|-------------|
| `DB_NAME` | `fraud_db` | |
| `fraud.rules.*` | see `FraudRulesConfig` | Thresholds: 100000 (+40), 500000 (+70), velocity > 5 in 10 min (+30), allowed countries `[IN]` (+25), anomaly 5x average of last 20 with ≥ 3 history (+20), night 00:00-05:00 IST (+10) |

### notification-service (8084)

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_NAME` | `notifications_db` | |
| `MAIL_HOST` | `localhost` | SMTP host (MailHog in docker) |
| `MAIL_PORT` | `1025` | SMTP port |

### audit-service (8085)

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_NAME` | `audit_db` | |

## 3. Any Spring property can be set by env var

Spring Boot "relaxed binding": `outbox.relay.interval-ms` → `OUTBOX_RELAY_INTERVALMS`,
`saga.timeout-minutes` → `SAGA_TIMEOUTMINUTES`, `fraud.rules.amount-threshold` →
`FRAUD_RULES_AMOUNTTHRESHOLD` (dots become `_`, dashes are removed, upper case).

## 4. Fixed settings (not meant to be changed per environment)

| Setting | Value |
|---------|-------|
| `spring.jpa.hibernate.ddl-auto` | `validate` |
| `spring.jpa.open-in-view` | `false` |
| `spring.jackson.serialization.write-dates-as-timestamps` | `false` |
| `eureka.client.enabled` | `false` |
| `management.endpoints.web.exposure.include` | `health,info,prometheus,metrics` |
| `management.health.redis.enabled` | `false` |
| Kafka consumer | `ack-mode: record`, `auto-offset-reset: earliest` |
| Kafka producer | `acks=all`, `enable.idempotence=true` |

## 5. Environments

| Environment | Where values come from |
|-------------|------------------------|
| Local (Maven/IDE) | Defaults in `application.yml` (+ `application-dev.yml`) |
| docker-compose | `environment:` blocks in `docker/docker-compose.yml` |
| Staging / Production | Secret manager + deployment manifests (see [secret-management](../security/secret-management.md)). Defaults for secrets must **never** be used. |

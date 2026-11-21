# Local Setup

There are two ways to run the platform locally:

- **Option A — everything in Docker** (easiest; nothing to install except Docker).
- **Option B — infrastructure in Docker, services from Maven/IDE** (best for development and debugging).

## 1. Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| JDK | 21 or newer (code targets Java 21) | `java -version` |
| Maven | 3.9+ | `mvn -v` |
| Docker Desktop (with Compose v2) | recent | `docker compose version` |
| Node.js (frontend only) | 18+ | `node -v` |
| Git | any | `git --version` |

Free ports: `8080-8085` (services), `5432` (Postgres), `9092` (Kafka), `6379` (Redis),
`1025`/`8025` (MailHog SMTP / web UI), `8090` (Kafka UI), `9090` (Prometheus), `3000` (Grafana),
`4317`/`4318` (OpenTelemetry collector), `5173` (frontend). Most host ports can be changed with
variables such as `POSTGRES_PORT`, `KAFKA_UI_PORT` (see `docker/.env.example`).

Give Docker at least 6 GB of memory for the full stack.

## 2. Option A — full stack in Docker

```bash
git clone https://github.com/prabuddh148/banking-platform.git
cd banking-platform

docker compose -f docker/docker-compose.yml up --build -d
docker compose -f docker/docker-compose.yml ps        # wait until all are healthy
```

This builds all six Spring Boot images and starts them together with Postgres, Kafka, Redis, MailHog
and the observability stack. Services get their configuration from environment variables in the
compose file (see [environment-config](environment-config.md)).

Logs and shutdown:

```bash
docker compose -f docker/docker-compose.yml logs -f transaction-service
docker compose -f docker/docker-compose.yml down        # stop
docker compose -f docker/docker-compose.yml down -v     # stop AND delete data volumes
```

## 3. Option B — infrastructure in Docker, services locally

### 3.1 Start infrastructure only

```bash
docker compose -f docker/docker-compose.dev.yml up -d
```

This starts Postgres (with the five databases created by the init scripts), Kafka, Redis and MailHog.

### 3.2 Build once

```bash
mvn clean install -DskipTests      # builds common-library and all services
```

`common-library` must be installed into your local Maven repository (`~/.m2`) before services can
build on their own.

### 3.3 Run the services

Open one terminal per service (or use the Spring Boot run configurations in your IDE). The defaults
in `application.yml` already point to `localhost`, so no env vars are needed:

```bash
mvn -pl api-gateway          spring-boot:run
mvn -pl account-service      spring-boot:run -Dspring-boot.run.profiles=dev
mvn -pl transaction-service  spring-boot:run -Dspring-boot.run.profiles=dev
mvn -pl fraud-service        spring-boot:run -Dspring-boot.run.profiles=dev
mvn -pl notification-service spring-boot:run -Dspring-boot.run.profiles=dev
mvn -pl audit-service        spring-boot:run -Dspring-boot.run.profiles=dev
```

The `dev` profile turns on SQL logging and DEBUG logs for `com.banking`.

On first start each service runs its Flyway migration and creates its Kafka topics.

### 3.4 Check health

```bash
for p in 8080 8081 8082 8083 8084 8085; do
  echo -n "$p: "; curl -s http://localhost:$p/actuator/health; echo
done
```

Every service should report `{"status":"UP"...}`.

## 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The gateway allows CORS from this origin by default.

## 5. Demo users

Issued by the api-gateway (`POST /api/v1/auth/login`):

| Username | Password | User id | Roles | Name |
|----------|----------|---------|-------|------|
| `rahul` | `password` | `CUST-1001` | ROLE_CUSTOMER | Rahul Sharma |
| `priya` | `password` | `CUST-1002` | ROLE_CUSTOMER | Priya Patel |
| `admin` | `admin123` | `ADMIN-1` | ROLE_ADMIN, ROLE_CUSTOMER | Devon Ellis |

These are demo credentials only. Never use them outside local development.

## 6. Smoke test

```bash
# 1. login
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"rahul","password":"password"}' | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')

# 2. open an account with an initial deposit
curl -s -X POST http://localhost:8080/api/v1/accounts \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"customerName":"Rahul Sharma","customerEmail":"rahul.sharma@example.com","accountType":"SAVINGS","currency":"INR","initialDeposit":10000}'

# 3. list my accounts
curl -s http://localhost:8080/api/v1/accounts -H "Authorization: Bearer $TOKEN"
```

The full flow (transfer + status polling) is in the root [README](../../README.md#example-flow-with-curl).

## 7. Useful local tools

| Tool | URL | Use |
|------|-----|-----|
| MailHog | http://localhost:8025 | See emails sent by notification-service |
| Kafka UI | http://localhost:8090 | Browse topics, messages, consumer lag |
| Prometheus | http://localhost:9090 | Metrics from `/actuator/prometheus` |
| Grafana | http://localhost:3000 (admin / admin) | Dashboards |
| psql | `docker compose -f docker/docker-compose.dev.yml exec postgres psql -U banking -d accounts_db` | Query databases (use `docker/docker-compose.yml` for the full stack) |

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Connection refused localhost:5432` | Postgres not up yet | `docker compose ... ps`, wait for healthy |
| `Schema-validation: missing table` | Flyway did not run / wrong DB | Check `DB_NAME`, look at `flyway_schema_history` |
| `FlywayValidateException: checksum mismatch` | An applied migration was edited | Reset the local DB (see [migration-strategy](../database/migration-strategy.md)) |
| `401 INVALID_TOKEN` from a service but login works | Different `JWT_SECRET` in gateway and service | Use the same secret everywhere |
| Transfer stays `PENDING` | fraud-service or Kafka down | Check fraud-service logs; see [kafka-consumer-lag](../runbooks/kafka-consumer-lag.md) |
| `Port already in use` | Something else on 8080-8085 | Stop it or change `SERVER_PORT` |
| Frontend CORS error | Different frontend origin | Set `CORS_ALLOWED_ORIGINS` on the gateway |

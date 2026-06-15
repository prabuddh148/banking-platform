# Local Development Setup

This guide walks a new developer through getting the banking platform running on a local machine from scratch.

---

## Prerequisites

Install the following before proceeding:

| Tool | Minimum Version | Notes |
|------|----------------|-------|
| Java (JDK) | 21 | Recommend Temurin distribution: https://adoptium.net |
| Maven | 3.9+ | Or use the bundled `mvnw` wrapper in each module |
| Docker Desktop | 4.25+ | Ensure the Docker daemon is running |
| Git | 2.40+ | |
| IntelliJ IDEA | 2024.1+ | Community edition works; Ultimate adds Spring support |

Verify your setup:

```bash
java -version          # Should show: openjdk 21.x.x
mvn -version           # Should show: Apache Maven 3.9.x
docker --version       # Should show: Docker version 25.x.x
docker compose version # Should show: Docker Compose version v2.x.x
```

---

## Step 1: Clone the Repository

```bash
git clone https://github.com/your-org/banking-platform.git
cd banking-platform
```

---

## Step 2: Configure Environment Variables

Copy the example environment file and fill in values as needed:

```bash
cp .env.example .env
```

For local development the defaults in `.env.example` work out of the box. You only need to provide real values for:

- `MAIL_USERNAME` / `MAIL_PASSWORD` — if you want email notifications to actually send
- `SMS_API_KEY` — if you want SMS notifications to actually send
- `JWT_SECRET` — replace the default with a randomly generated value for any shared environment

To generate a secure JWT secret:

```bash
openssl rand -base64 64
```

---

## Step 3: Build All Services

From the repository root, build all modules in one pass:

```bash
mvn clean install -DskipTests
```

This compiles all services and produces the fat JARs in each service's `target/` directory. The first build downloads dependencies and takes approximately 3-5 minutes; subsequent builds are faster.

To build a single service:

```bash
cd account-service
mvn clean install -DskipTests
```

---

## Step 4: Start Infrastructure Services

Start only the infrastructure (databases, Kafka, observability) without the application services:

```bash
cd docker
docker compose up zookeeper kafka kafka-ui \
  postgres-account postgres-transaction postgres-fraud \
  postgres-notification postgres-audit \
  prometheus grafana otel-collector -d
```

Wait for all containers to be healthy:

```bash
docker compose ps
```

All services should show `healthy` status. This typically takes 30-60 seconds.

---

## Step 5: Create Kafka Topics

After Kafka is healthy, run the topic creation script:

```bash
bash infrastructure/kafka/topics/create-topics.sh
```

The script waits for Kafka to be ready before creating topics. You should see output confirming each topic was created.

To verify topics were created:

```bash
docker exec banking-kafka kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --list
```

---

## Step 6: Start Application Services

### Option A: Run Services Individually (Recommended for Development)

Open a terminal for each service and run:

```bash
cd account-service && mvn spring-boot:run
cd transaction-service && mvn spring-boot:run
cd fraud-service && mvn spring-boot:run
cd notification-service && mvn spring-boot:run
cd audit-service && mvn spring-boot:run
cd api-gateway && mvn spring-boot:run
```

### Option B: Run All Services in Docker

```bash
cd docker
docker compose --profile app up
```

### Option C: Development Mode with Remote Debugging

```bash
cd docker
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile app up
```

Connect your IDE debugger to:
- `localhost:5005` for api-gateway
- `localhost:5006` for account-service
- `localhost:5007` for transaction-service
- `localhost:5008` for fraud-service
- `localhost:5009` for notification-service
- `localhost:5010` for audit-service

In IntelliJ IDEA: Run > Edit Configurations > + > Remote JVM Debug > set host/port.

---

## Step 7: Verify Services are Running

Check actuator health endpoints:

```bash
curl -s http://localhost:8080/actuator/health | jq .  # api-gateway
curl -s http://localhost:8081/actuator/health | jq .  # account-service
curl -s http://localhost:8082/actuator/health | jq .  # transaction-service
curl -s http://localhost:8083/actuator/health | jq .  # fraud-service
curl -s http://localhost:8084/actuator/health | jq .  # notification-service
curl -s http://localhost:8085/actuator/health | jq .  # audit-service
```

Each should respond with `{"status":"UP"}`.

---

## Useful URLs

| Service | URL | Credentials |
|---------|-----|-------------|
| API Gateway | http://localhost:8080 | JWT Bearer token |
| Account Service (direct) | http://localhost:8081 | — |
| Transaction Service (direct) | http://localhost:8082 | — |
| Fraud Service (direct) | http://localhost:8083 | — |
| Notification Service (direct) | http://localhost:8084 | — |
| Audit Service (direct) | http://localhost:8085 | — |
| Kafka UI | http://localhost:8090 | — |
| Prometheus | http://localhost:9090 | — |
| Grafana | http://localhost:3000 | admin / admin |
| OTel Collector (zpages) | http://localhost:55679/debug/tracez | — |

---

## Common Troubleshooting

### Port already in use

A local PostgreSQL instance may be running. Stop it or change the port mapping. Note that postgres-account uses `5433:5432` already to avoid conflicts.

### Kafka not ready / topics not created

```bash
docker compose logs kafka --tail=50
```

Look for "KafkaServer id=1 started" in the logs, then re-run the topic script.

### Service fails to start: "Unable to acquire JDBC Connection"

The PostgreSQL container may not be healthy yet. Check:

```bash
docker compose ps
docker compose logs postgres-account --tail=30
```

### Out of memory during Maven build

```bash
export MAVEN_OPTS="-Xmx2g"
mvn clean install -DskipTests
```

### Grafana shows "No data" in dashboards

1. Open http://localhost:9090/targets and verify all targets are UP.
2. Generate some traffic (make API calls) so metrics are populated.
3. In Grafana, check the time range selector — default may be "last 1 hour" with no data yet.

### Resetting the entire environment

To tear down everything and start fresh (WARNING: deletes all data):

```bash
cd docker
docker compose --profile app down -v --remove-orphans
docker compose down -v --remove-orphans
```

Then restart from Step 4.

---

## IDE Setup (IntelliJ IDEA)

1. Open IntelliJ IDEA and choose **Open** > select the `banking-platform` root directory.
2. IntelliJ detects the Maven multi-module project and imports all modules.
3. Set Project SDK: **File > Project Structure > SDKs > + > JDK 21**.
4. Enable annotation processing: **Settings > Build > Compiler > Annotation Processors > Enable**.
5. Install plugins:
   - **Lombok** (required — annotation processing will fail without it)
   - **Spring Boot** (bundled in Ultimate, available via Marketplace for Community)
   - **Docker** (for Compose file editing with validation)

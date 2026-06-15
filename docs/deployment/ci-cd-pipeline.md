# CI/CD Pipeline

**Applies to**: All Banking Platform services  
**Last Updated**: 2024-01-22  
**Owner**: DevOps / Platform Engineering  
**Primary Stack**: GitHub Actions + Docker Hub + Docker Compose (staging) / Kubernetes (production)

---

## Overview

Every code change to the Banking Platform follows this automated pipeline:

```
Developer Push / PR
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│                    CI (GitHub Actions)                  │
│  1. Checkout + Cache    5. Static Analysis              │
│  2. Build (Maven)       6. Docker Build                 │
│  3. Unit Tests          7. Push Image to Registry       │
│  4. Integration Tests                                   │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│              CD — Staging (Auto)                        │
│  Triggered on merge to main                             │
│  Docker Compose pull + restart on staging server        │
└─────────────────────────────────────────────────────────┘
        │
        ▼
   Manual Approval Gate
   (Team Lead or Release Manager)
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│              CD — Production (Manual Gate)              │
│  Kubernetes rolling update (patch) or blue/green        │
│  See rollout-strategy.md for release type procedures    │
└─────────────────────────────────────────────────────────┘
```

---

## Repository Structure

The Banking Platform is a Maven multi-module project. The CI pipeline builds and tests all modules together, then builds Docker images per-service:

```
banking-platform/
├── pom.xml                    ← Parent POM (module coordinator)
├── common-library/            ← Shared code; built first
├── api-gateway/
├── account-service/
├── transaction-service/
├── fraud-service/
├── notification-service/
├── audit-service/
└── .github/
    └── workflows/
        ├── ci.yml             ← CI pipeline (runs on every PR and push)
        └── deploy.yml         ← CD pipeline (runs on merge to main)
```

---

## CI Pipeline Stages

### Stage 1: Checkout and Cache Maven Dependencies

```yaml
- name: Checkout
  uses: actions/checkout@v4

- name: Set up JDK 21
  uses: actions/setup-java@v4
  with:
    java-version: '21'
    distribution: 'temurin'
    cache: 'maven'

- name: Cache Maven local repository
  uses: actions/cache@v4
  with:
    path: ~/.m2/repository
    key: ${{ runner.os }}-maven-${{ hashFiles('**/pom.xml') }}
    restore-keys: |
      ${{ runner.os }}-maven-
```

**Why cache Maven?** The `~/.m2/repository` contains ~200MB of dependencies. Caching reduces this stage from ~3 minutes to ~20 seconds on cache hit.

### Stage 2: Build

```yaml
- name: Build all modules
  run: mvn clean package -DskipTests --batch-mode --no-transfer-progress
```

`-DskipTests`: Tests run in separate stages to keep feedback fast and to separate build failures from test failures.  
`--batch-mode`: Suppresses interactive Maven output for cleaner CI logs.  
`--no-transfer-progress`: Suppresses download progress bars (noisy in CI logs).

**Exit condition**: If any module fails to compile, the pipeline fails immediately and no further stages run.

### Stage 3: Unit Tests

```yaml
- name: Run unit tests
  run: mvn test --batch-mode --no-transfer-progress
  
- name: Publish unit test results
  uses: mikepenz/action-junit-report@v4
  if: always()
  with:
    report_paths: '**/target/surefire-reports/*.xml'
```

Unit tests use no external dependencies (databases, Kafka). They use Mockito for mocking. Target runtime: under 2 minutes for the full test suite.

### Stage 4: Integration Tests

```yaml
- name: Run integration tests
  run: mvn verify -Pfailsafe --batch-mode --no-transfer-progress
  env:
    TESTCONTAINERS_RYUK_DISABLED: "false"
```

Integration tests use **Testcontainers** to spin up real PostgreSQL 16 and Kafka containers. Each test class manages its own containers using `@Testcontainers` and `@Container` annotations.

```java
@SpringBootTest
@Testcontainers
class TransferSagaIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres =
        new PostgreSQLContainer<>("postgres:16-alpine");

    @Container
    static KafkaContainer kafka =
        new KafkaContainer(DockerImageName.parse("confluentinc/cp-kafka:7.5.0"));

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.kafka.bootstrap-servers", kafka::getBootstrapServers);
    }
}
```

Target runtime: under 10 minutes. Integration tests run in parallel across modules (`-T 1C` is not used here because Testcontainers port binding requires sequential startup per module).

### Stage 5: Static Analysis

```yaml
- name: Checkstyle
  run: mvn checkstyle:check --batch-mode

- name: SpotBugs
  run: mvn spotbugs:check --batch-mode
```

**Checkstyle**: Enforces code style rules defined in `checkstyle.xml`. Violations fail the build. Style configuration is shared via `common-library/src/main/resources/checkstyle.xml`.

**SpotBugs**: Static analysis for common Java bugs (null pointer dereferences, SQL injection patterns, resource leaks). High-priority bugs fail the build; medium-priority bugs generate warnings.

Both tools are optional gates in early development (configured with `<failsOnError>false</failsOnError>`) and graduate to hard fails before the first production release.

### Stage 6: Docker Build

Each service is built as a multi-stage Docker image. The Dockerfile pattern for all services:

```dockerfile
# Stage 1: Build
FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /app

# Copy parent POM and service POM for dependency caching
COPY pom.xml ./pom.xml
COPY common-library/pom.xml ./common-library/pom.xml
COPY account-service/pom.xml ./account-service/pom.xml

# Download dependencies (cached layer if POMs unchanged)
RUN mvn dependency:go-offline -pl common-library,account-service --batch-mode

# Copy source and build
COPY common-library/src ./common-library/src
COPY account-service/src ./account-service/src
RUN mvn clean package -DskipTests -pl common-library,account-service --batch-mode

# Stage 2: Runtime image (minimal — no JDK, no Maven)
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Non-root user for security
RUN addgroup -S bankapp && adduser -S bankapp -G bankapp
USER bankapp

# Health check (matches Spring Boot actuator)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:8090/actuator/health || exit 1

COPY --from=builder /app/account-service/target/*.jar app.jar

ENTRYPOINT ["java", \
  "-XX:MaxRAMPercentage=75.0", \
  "-XX:+UseContainerSupport", \
  "-Djava.security.egd=file:/dev/./urandom", \
  "-jar", "app.jar"]
```

**JVM flags explanation**:
- `-XX:MaxRAMPercentage=75.0`: Use 75% of container memory limit for heap (avoids OOM kills)
- `-XX:+UseContainerSupport`: Respect container cgroup memory limits (Java 21 default, explicit for clarity)
- `-Djava.security.egd=file:/dev/./urandom`: Faster startup on Linux (avoids `/dev/random` blocking)

```yaml
- name: Build Docker images
  run: |
    for service in api-gateway account-service transaction-service fraud-service notification-service audit-service; do
      docker build -t banking-platform/${service}:${GITHUB_SHA} \
                   -t banking-platform/${service}:latest \
                   -f ${service}/Dockerfile .
    done
```

### Stage 7: Push to Registry

```yaml
- name: Login to Docker Hub
  uses: docker/login-action@v3
  with:
    username: ${{ secrets.DOCKERHUB_USERNAME }}
    password: ${{ secrets.DOCKERHUB_TOKEN }}

- name: Push images
  run: |
    for service in api-gateway account-service transaction-service fraud-service notification-service audit-service; do
      docker push banking-platform/${service}:${GITHUB_SHA}
      docker push banking-platform/${service}:latest
    done
```

**Image tagging strategy**:
- `{service}:{git-sha}` — immutable tag for a specific commit; used for deployment and rollback
- `{service}:latest` — floating tag pointing to the most recent build from `main`; not used for production deploys (use the SHA tag for reproducibility)

---

## CD Pipeline — Staging (Auto-Deploy)

Staging deployment triggers automatically on every merge to `main`:

```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]

jobs:
  deploy-staging:
    needs: [ci]     # Only deploys if CI passes
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - name: Deploy to staging
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.STAGING_HOST }}
          username: ${{ secrets.STAGING_USER }}
          key: ${{ secrets.STAGING_SSH_KEY }}
          script: |
            cd /opt/banking-platform
            export IMAGE_TAG=${{ github.sha }}
            docker compose pull
            docker compose up -d --no-deps --remove-orphans
            docker compose ps
```

**`--no-deps`**: Updates only the changed service containers, not their dependencies (databases, Kafka). This prevents unnecessary Kafka restarts during service deployments.

**Staging smoke test** (runs after deploy):

```yaml
      - name: Staging smoke test
        run: |
          sleep 30  # Wait for containers to be healthy
          curl -f https://staging.bank.internal/actuator/health
          curl -f https://staging.bank.internal/api/v1/accounts/health
```

---

## CD Pipeline — Production (Manual Approval Gate)

Production deployments require explicit approval from a team lead or release manager:

```yaml
  deploy-production:
    needs: [deploy-staging]
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://bank.com
    # GitHub Environment protection rules require manual approval
    steps:
      - name: Deploy to production
        run: |
          # Kubernetes rolling update
          kubectl set image deployment/account-service \
            account-service=banking-platform/account-service:${{ github.sha }}
          kubectl rollout status deployment/account-service --timeout=300s
```

The `environment: production` configuration in GitHub triggers the configured protection rule (manual approval from `CODEOWNERS` team members). The deployment does not proceed until approved.

---

## Database Migrations in the Pipeline

Flyway migrations run automatically at **service startup**, not as a separate pipeline step.

**Why startup-time migrations (not pipeline step)**:
- Ensures the migration and the code that depends on it deploy atomically
- No separate credentials needed in CI/CD for the production database
- Flyway's lock mechanism prevents concurrent migration runs during rolling updates

**Migration backward-compatibility requirement**: Migrations must be backward-compatible with the N-1 version of the service. During a rolling update, the old version of the service may be running against the new schema for a brief window. See `docs/deployment/rollout-strategy.md` for the N-1 compatibility rules.

---

## Secret Injection

CI/CD secrets are stored in **GitHub Actions Secrets** (Settings → Secrets and Variables → Actions). They are never printed to logs or stored in artifacts.

| Secret Name | Used In | Notes |
|---|---|---|
| `DOCKERHUB_USERNAME` | Stage 7: Push | Docker Hub account |
| `DOCKERHUB_TOKEN` | Stage 7: Push | Docker Hub access token (not password) |
| `STAGING_HOST` | CD: Staging | IP or hostname of staging server |
| `STAGING_USER` | CD: Staging | SSH username |
| `STAGING_SSH_KEY` | CD: Staging | Private key for SSH access |
| `STAGING_JWT_SECRET` | CD: Staging | Injected as `JWT_SECRET` env var |
| `STAGING_DB_PASSWORD` | CD: Staging | Injected per-service |
| `PROD_AWS_ACCESS_KEY_ID` | CD: Production | AWS credentials for ECS/EKS deploy |
| `PROD_AWS_SECRET_ACCESS_KEY` | CD: Production | AWS credentials for ECS/EKS deploy |

Production application secrets (JWT_SECRET, DB_PASSWORD, etc.) are **not stored in GitHub Secrets**. They are stored in **AWS Secrets Manager** and injected at container startup by the container runtime (ECS Task Definition `secrets` block or Kubernetes External Secrets Operator).

---

## Rollback Procedure

If a production deployment causes errors:

1. **Identify the previous stable image tag** from the GitHub Actions run history or Docker Hub tag list.
2. **Re-deploy the previous image**:
   ```bash
   kubectl set image deployment/account-service \
     account-service=banking-platform/account-service:{PREVIOUS_SHA}
   kubectl rollout status deployment/account-service
   ```
3. **Verify rollback**: Check error rates in Grafana. Confirm health checks pass.
4. **If Flyway migration ran**: The migration cannot be automatically rolled back. Apply a compensating forward migration. See `docs/deployment/rollout-strategy.md` — Rollback Procedure.
5. **Open a post-incident issue** documenting what failed and why.

---

## Pipeline Timing Targets

| Stage | Target Duration | Acceptable Maximum |
|---|---|---|
| Checkout + Cache | 30s | 2 min |
| Build | 2 min | 5 min |
| Unit Tests | 2 min | 5 min |
| Integration Tests | 8 min | 15 min |
| Static Analysis | 1 min | 3 min |
| Docker Build (all 6 services) | 5 min | 10 min |
| Push to Registry | 2 min | 5 min |
| **Total CI** | **~20 min** | **45 min** |
| Staging Deploy + Smoke Test | 3 min | 10 min |
| Production Deploy | 5 min | 15 min |

If total CI time exceeds 45 minutes, investigate parallelization opportunities (matrix builds per service, TestContainers reuse).

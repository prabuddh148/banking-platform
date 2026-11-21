# CI/CD Pipeline

This document describes the intended pipeline (GitHub Actions). It builds every module, runs tests,
builds Docker images and promotes them through environments.

## 1. Overview

```
 push / PR ──► [1 Build & test] ──► [2 Quality & security] ──► [3 Docker images]
                                                                    │ (main only)
                                                                    ▼
                         [6 Production] ◄── approval ◄── [5 Staging + smoke] ◄── [4 Publish images]
```

| Stage | Trigger | What happens |
|-------|---------|--------------|
| 1. Build & test | every push and PR | `mvn -B verify` on JDK 21 (unit + slice tests; no Docker needed) |
| 2. Quality & security | every PR | Dependency scan, secret scan, OpenAPI lint, frontend build |
| 3. Docker images | every PR (build only) / `main` | Build one image per service |
| 4. Publish | `main` | Push images tagged with the git SHA |
| 5. Staging | `main` | Deploy, run Flyway (on startup), run smoke tests |
| 6. Production | manual approval | Rolling deploy (see [rollout-strategy](rollout-strategy.md)) |

## 2. Stage details

### 2.1 Build & test

```yaml
- uses: actions/setup-java@v4
  with: { distribution: temurin, java-version: '21', cache: maven }
- run: mvn -B -ntp verify
```

- The reactor builds `common-library` first, then all services.
- Tests must not need external infrastructure (Mockito, `@WebMvcTest`, H2).
- Test reports (`target/surefire-reports`) are uploaded as artifacts.
- Only changed modules can be built for speed: `mvn -pl <module> -am verify`.

### 2.2 Quality & security

| Check | Tool (suggested) |
|-------|------------------|
| Dependency vulnerabilities | OWASP Dependency-Check or GitHub Dependabot |
| Secrets in code | gitleaks |
| OpenAPI contracts valid | `npx @redocly/cli lint docs/api-contracts/*.yaml` |
| Frontend builds | `cd frontend && npm ci && npm run build` |
| Image scan | Trivy on built images |

A PR cannot merge if a high/critical vulnerability without an exception is found.

### 2.3 Docker images

- One image per service, built from the module's Dockerfile (multi-stage: Maven build → JRE 21 runtime).
- Tag: `banking/<service>:<git-sha>`; `main` also gets `latest` for staging only.
- Images run as a non-root user and expose only the service port.

### 2.4 Staging and smoke tests

After deploy:
1. Wait for `/actuator/health` = `UP` on all services.
2. Run the smoke flow: login → create account → deposit → transfer → poll status until `COMPLETED`.
3. Check there are no messages in `*.DLT` topics and no `FAILED` outbox rows.

Locally the same can be done with `docker compose -f docker/docker-compose.test.yml up` (test stack).

### 2.5 Production

- Manual approval in GitHub Environments.
- The **same image** (same SHA) that passed staging is deployed — never rebuilt.
- Rolling deploy, one service at a time, in this order when contracts changed:
  consumers first (they must accept new fields), then producers.

## 3. Branching

- `main` is always releasable and protected (PR + green checks required).
- Short-lived feature branches: `feat/...`, `fix/...`, `docs/...`.
- Conventional commits (`feat(account-service): ...`) — used to build the changelog.

## 4. Secrets in CI

- Registry credentials and deploy keys are stored as GitHub Actions secrets / environment secrets.
- CI never needs `JWT_SECRET` or DB passwords for tests.
- See [secret-management](../security/secret-management.md).

## 5. Database migrations in the pipeline

Flyway runs at service startup. Because migrations are backward compatible
([migration-strategy](../database/migration-strategy.md)), the new schema works with the old code
while the rollout is in progress.

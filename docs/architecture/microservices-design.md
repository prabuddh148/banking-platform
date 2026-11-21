# Microservices Design

This document explains how the platform is split into services, what each service owns, and the
common structure every service follows.

## 1. Service boundaries

Services are split by **business capability**. Each one owns its data and is the only writer of it.

| Service | Owns | Publishes | Consumes |
|---------|------|-----------|----------|
| **api-gateway** | Login, routing, edge security | – | – |
| **account-service** | Accounts, balances, holds, status history | `ACCOUNT_CREATED`, `ACCOUNT_STATUS_CHANGED`, `BALANCE_UPDATED`, `BALANCE_UPDATE_FAILED` (outbox) | `BALANCE_UPDATE_REQUESTED` |
| **transaction-service** | Transactions, status history, saga state | `TRANSACTION_INITIATED`, `BALANCE_UPDATE_REQUESTED`, `TRANSACTION_COMPLETED`, `TRANSACTION_FAILED` (outbox) | `FRAUD_CLEARED`, `FRAUD_DETECTED`, `BALANCE_UPDATED`, `BALANCE_UPDATE_FAILED` |
| **fraud-service** | Fraud decisions, fraud alerts, rule config | `FRAUD_CLEARED`, `FRAUD_DETECTED` (direct) | `TRANSACTION_INITIATED` |
| **notification-service** | Notifications, customer contact copies | (`NOTIFICATION_REQUESTED` may be produced by any service) | `ACCOUNT_CREATED`, `ACCOUNT_STATUS_CHANGED`, `TRANSACTION_COMPLETED`, `TRANSACTION_FAILED`, `NOTIFICATION_REQUESTED` |
| **audit-service** | Immutable audit log | – | everything on the account, transaction and fraud topics |

Rules:
- A service never reads another service's database.
- A service never calls another service synchronously inside the money flow. Cross-service work
  goes through Kafka.
- Shared code lives only in `common-library` and contains **no business logic** (DTO envelopes,
  error codes, event base class, JWT helpers, validators).

## 2. Ports and configuration

| Service | Port | Database | Kafka group id | `spring.application.name` |
|---------|------|----------|----------------|---------------------------|
| api-gateway | 8080 | – | – | api-gateway |
| account-service | 8081 | accounts_db | account-service | account-service |
| transaction-service | 8082 | transactions_db | transaction-service | transaction-service |
| fraud-service | 8083 | fraud_db | fraud-service | fraud-service |
| notification-service | 8084 | notifications_db | notification-service | notification-service |
| audit-service | 8085 | audit_db | audit-service | audit-service |

All configuration comes from environment variables with local defaults (see
[environment-config](../deployment/environment-config.md)). There is no Eureka server:
`eureka.client.enabled: false`; the gateway uses fixed URLs from env vars.

## 3. Inside a service (layered structure)

Each servlet service follows the same package layout so that the code is easy to navigate:

```
com.banking.<service>
├── <Service>Application.java     @SpringBootApplication (+ @EnableScheduling where needed)
├── config/        SecurityConfig, KafkaProducerConfig/KafkaConsumerConfig, other @Configuration
├── controller/    @RestController — HTTP only: validate input, call service, wrap in ApiResponse
├── dto/           request/response records or classes (never expose entities)
├── entity/        JPA @Entity classes
├── repository/    Spring Data JPA interfaces
├── service/       interfaces + impl/ classes with @Transactional business logic
├── event/         event classes (extend BaseEvent), producers/consumers
├── outbox/        OutboxEvent entity + OutboxEventRelay (account, transaction)
├── security/      JwtTokenValidator, JwtAuthenticationFilter
├── exception/     service exceptions (extend BankingException) + GlobalExceptionHandler
└── resources/
    ├── application.yml, application-dev.yml
    └── db/migration/V1__*.sql   (Flyway)
```

Conventions:
- Constructor injection with Lombok `@RequiredArgsConstructor`.
- Service interface + `Impl` class; `@Transactional` on service methods.
- `spring.jpa.hibernate.ddl-auto: validate`, `spring.jpa.open-in-view: false`.
- Money is `BigDecimal` with scale 2, `HALF_EVEN` rounding (`MoneyUtil`).
- Exceptions extend `BankingException(ErrorCode, message)`; the global handler turns them into
  `ApiResponse.error(...)` with the right HTTP status.

## 4. The API gateway

The gateway is **reactive** (Spring Cloud Gateway on WebFlux), unlike the other servlet services.

| Concern | How |
|---------|-----|
| Login | `POST /api/v1/auth/login` against demo users in `gateway.auth.users`; `GET /api/v1/auth/me` |
| Routing | `/api/v1/accounts/**` → `ACCOUNT_SERVICE_URL` (default `http://localhost:8081`), and the same for transactions (8082), fraud (8083), notifications (8084), audit (8085) |
| Auth filter | Global `JwtAuthenticationFilter`; open paths: `/api/v1/auth/login`, `/actuator/**` |
| Headers | Forwards `Authorization`; adds `X-User-Id`, `X-User-Roles`, `X-Trace-Id` |
| Tracing | `TraceIdPropagationFilter` creates `X-Trace-Id` if missing and returns it in the response |
| Logging | `RequestLoggingFilter`: method, path, status, duration |
| CORS | `http://localhost:5173` by default (`CORS_ALLOWED_ORIGINS`) |
| Resilience | Circuit breaker per route; fallback `/fallback/{service}` → `503` with `SERVICE_UNAVAILABLE` |
| Health | `GET /api/v1/system/health` (admin) aggregates every service's `/actuator/health` |

## 5. Communication styles

| Style | Used for | Example |
|-------|----------|---------|
| REST via gateway | Client requests | `GET /api/v1/accounts` |
| Kafka events (outbox) | State changes that others must reliably see | `BALANCE_UPDATED` |
| Kafka events (direct) | Derived decisions/notifications | `FRAUD_CLEARED` |

## 6. Data ownership and duplication

Some data is copied on purpose:

- notification-service stores customer contact details (email, phone, name) from `ACCOUNT_CREATED`,
  so it can send emails without calling account-service.
- fraud-service keeps its own decision history per account to evaluate velocity and pattern rules.
- audit-service keeps a masked copy of every event.

These copies are **eventually consistent**. The owning service is always the source of truth.

## 7. Scaling

- All services are stateless (JWT, no HTTP sessions) and can run multiple instances.
- Kafka partitions (3 per topic) limit consumer parallelism to 3 instances per consumer group.
- The outbox relay runs in every instance; rows are claimed with row locks (`FOR UPDATE SKIP LOCKED`
  is recommended) so two instances do not send the same batch at the same time. Duplicate sends are
  still safe because consumers are idempotent.
- Scheduled jobs (saga timeout, notification retry) are idempotent, so running them in several
  instances is safe; a distributed lock (e.g. ShedLock) can be added later.

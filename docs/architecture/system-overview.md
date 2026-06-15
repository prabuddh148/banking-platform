# System Architecture Overview

## Platform Summary

The banking platform is a cloud-native, event-driven microservices system designed for reliable, auditable financial transaction processing. It uses the Saga pattern for distributed transaction management, Kafka for asynchronous inter-service communication, and the Outbox pattern to guarantee exactly-once event delivery.

---

## Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │                 CLIENTS                      │
                    │    Web App (React)    Mobile App             │
                    └──────────────────┬──────────────────────────┘
                                       │ HTTPS
                                       v
┌──────────────────────────────────────────────────────────────────┐
│                      API GATEWAY  :8080                          │
│              (Spring Cloud Gateway + JWT Auth)                   │
│       Rate Limiting  CORS  Request Routing  Circuit Breaking     │
└────┬──────────┬──────────┬──────────┬───────────┬───────────────┘
     │          │          │          │           │
     v          v          v          v           v
┌─────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐
│ account │ │transaction│ │ fraud │ │notificat.│ │  audit   │
│ service │ │  service  │ │service│ │ service  │ │ service  │
│  :8081  │ │   :8082   │ │ :8083 │ │  :8084   │ │  :8085   │
└────┬────┘ └─────┬─────┘ └───┬───┘ └────┬─────┘ └────┬─────┘
     │            │           │          │            │
     v            v           v          v            v
┌─────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐
│account  │ │transact. │ │ fraud  │ │notificat.│ │  audit   │
│   db    │ │    db    │ │   db   │ │    db    │ │    db    │
│ :5433   │ │  :5434   │ │ :5435  │ │  :5436   │ │  :5437   │
│(schema: │ │(schema:  │ │(schema:│ │(schema:  │ │(schema:  │
│accounts)│ │transact.)│ │ fraud) │ │notificat)│ │  audit)  │
└─────────┘ └──────────┘ └────────┘ └──────────┘ └──────────┘

           All services connect to:

  ┌──────────────────────────────────────────────────────────┐
  │                   APACHE KAFKA  :9092                    │
  │                                                          │
  │  account.created           transaction.initiated         │
  │  account.status.changed    transaction.processing        │
  │  fraud.decision            transaction.completed         │
  │  fraud.detected            transaction.failed            │
  │  notification.requested    *.DLT (dead letter topics)   │
  └───────────────────────────┬──────────────────────────────┘
                              │
                              v
                    ┌─────────────────┐
                    │   ZOOKEEPER     │
                    │    :2181        │
                    └─────────────────┘

  ┌──────────────────────────────────────────────────────────┐
  │                 OBSERVABILITY STACK                      │
  │                                                          │
  │  OTel Collector :4317/:4318  ---> Prometheus :9090       │
  │                                        │                 │
  │                                        v                 │
  │                                   Grafana :3000          │
  │                                                          │
  │  Kafka UI :8090                                          │
  └──────────────────────────────────────────────────────────┘
```

---

## Service Responsibilities

### API Gateway (port 8080)
The single entry point for all client traffic. Responsibilities:
- JWT validation and propagation of authentication headers to downstream services
- Request routing to appropriate microservices
- Rate limiting (token bucket per IP address)
- CORS policy enforcement
- Circuit breaking with fallback responses

Technology: Spring Cloud Gateway (reactive, non-blocking)

### Account Service (port 8081)
Manages the lifecycle of bank accounts. Responsibilities:
- Account creation, retrieval, and status management (PENDING, ACTIVE, SUSPENDED, CLOSED)
- Balance inquiries and balance updates as part of transaction processing
- Publishing `account.created` and `account.status.changed` events to Kafka
- Consuming `transaction.processing` to apply debits/credits
- Consuming `fraud.detected` to automatically suspend compromised accounts

Database: `account_db`, schema: `accounts`

### Transaction Service (port 8082)
Orchestrates the full lifecycle of a financial transaction using the Saga pattern. Responsibilities:
- Accepting and validating transaction requests
- Orchestrating the transaction saga: initiate -> fraud check -> process -> complete/fail
- Publishing saga step events
- Implementing compensating transactions on failure (saga rollback)
- Using the Outbox pattern to guarantee Kafka event delivery

Database: `transaction_db`, schema: `transactions`

### Fraud Service (port 8083)
Real-time fraud detection for every transaction. Responsibilities:
- Consuming `transaction.initiated` events and evaluating risk in under 500ms
- Scoring transactions based on velocity checks, amount thresholds, and historical patterns
- Publishing `fraud.decision` (APPROVED/REJECTED/MANUAL_REVIEW) with a risk score
- Publishing `fraud.detected` for high-confidence fraud cases
- Maintaining per-account risk profiles and transaction velocity windows

Database: `fraud_db`, schema: `fraud`

### Notification Service (port 8084)
Handles all outbound user communications. Responsibilities:
- Consuming `notification.requested` events from all services
- Routing notifications to the appropriate channel (email, SMS, push) based on user preferences
- Retry with exponential backoff for failed deliveries
- Deduplication to prevent duplicate notifications

Database: `notification_db`, schema: `notifications`

### Audit Service (port 8085)
Provides an immutable audit trail for compliance and support. Responsibilities:
- Consuming events from all topics and writing append-only audit log entries
- Supporting point-in-time queries for compliance reporting
- Tracking all state transitions for accounts and transactions

Database: `audit_db`, schema: `audit`

---

## Key Design Decisions

### Event-Driven Architecture
Services communicate asynchronously through Kafka. This decouples services, improves fault tolerance, and enables each service to evolve independently. See [ADR-0001](../adr/0001-use-kafka-for-async.md).

### Saga Pattern (Orchestration)
Distributed transactions across account-service and transaction-service use an orchestration-based saga. The transaction-service owns the saga state machine and drives each step by publishing commands. See [ADR-0002](../adr/0002-saga-orchestration.md).

### Outbox Pattern
Services write events to an outbox table within the same database transaction as the domain entity change. A background process reads the outbox and publishes to Kafka. This eliminates the dual-write problem. See [ADR-0003](../adr/0003-outbox-pattern.md).

### Database per Service
Each microservice has its own dedicated PostgreSQL database. Services cannot query each other's databases directly. Data sharing happens exclusively through Kafka events. This enforces bounded contexts and enables independent scaling.

### Dead Letter Topics
Every primary Kafka topic has a corresponding `.DLT` Dead Letter Topic. Failed messages after retry exhaustion are routed here. DLT messages retain for 30 days to allow investigation and replay.

---

## Data Flow: Successful Transaction

```
1.  Client       POST /api/v1/transactions            -> API Gateway
2.  API Gateway  route + validate JWT                 -> Transaction Service
3.  Txn Service  validate, create saga, persist outbox -> transaction_db
4.  Txn Service  publish event                        -> Kafka: transaction.initiated
5.  Fraud Svc    evaluate risk score                  -> fraud_db
6.  Fraud Svc    publish decision (APPROVED)          -> Kafka: fraud.decision
7.  Txn Service  receive APPROVED, update saga        -> transaction_db
8.  Txn Service  publish processing command           -> Kafka: transaction.processing
9.  Account Svc  debit source, credit destination     -> account_db
10. Txn Service  receive settlement confirmed         -> transaction_db
11. Txn Service  publish completion event             -> Kafka: transaction.completed
12. Notif. Svc   send confirmation to user            -> Email/SMS
13. Audit Svc    record each step as audit entry      -> audit_db
```

## Data Flow: Fraud Rejected Transaction

```
1-5. (same as above, steps 1-5)
6.  Fraud Svc    publish decision (REJECTED, score=92) -> Kafka: fraud.decision
7.  Fraud Svc    publish fraud detected               -> Kafka: fraud.detected
8.  Account Svc  suspend account                      -> account_db
9.  Txn Service  receive REJECTED, trigger rollback   -> transaction_db
10. Txn Service  publish failure event                -> Kafka: transaction.failed
11. Notif. Svc   send fraud alert to user             -> Email + SMS
12. Audit Svc    record fraud detection and suspension -> audit_db
```

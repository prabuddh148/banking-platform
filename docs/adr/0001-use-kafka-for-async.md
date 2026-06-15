# ADR-0001: Use Apache Kafka for Asynchronous Inter-Service Communication

**Status:** Accepted

**Date:** 2024-01-15

**Deciders:** Platform Engineering Team

**Technical Area:** Messaging Infrastructure

---

## Context

The banking platform consists of six microservices that need to coordinate with each other: account-service, transaction-service, fraud-service, notification-service, audit-service, and api-gateway. Several cross-cutting concerns require multiple services to react to the same events:

1. When a transaction is initiated, both the fraud-service and audit-service need to know.
2. When fraud is detected, both the account-service (to suspend the account) and notification-service (to alert the customer) must act.
3. When a transaction completes, both the notification-service and audit-service must record the outcome.

**Synchronous REST Calls Were Evaluated**

The simplest approach would be direct HTTP calls between services. The transaction-service would call fraud-service synchronously, wait for a response, then call notification-service, and so on. This approach was considered and rejected for the following reasons:

- **Tight coupling:** A failure in notification-service (which is non-critical) would cause the transaction flow to fail. Services that are conceptually independent would be operationally coupled.
- **Cascading latency:** Total request latency would be the sum of all downstream service call latencies, not the maximum. A slow fraud-service response would block the entire transaction.
- **Fan-out complexity:** Multiple services (fraud, audit, notification) need to react to the same event. With synchronous calls, the emitting service must know about and call every subscriber — a violation of the Open-Closed Principle. Adding a new consumer requires modifying the producer.
- **Reduced availability:** The transaction-service would be unavailable whenever any downstream service it depends on is unavailable, even for non-critical dependencies.

**Message Queue Alternatives Were Evaluated**

RabbitMQ and Amazon SQS were also considered:

- **RabbitMQ:** Mature message broker, well-supported in Spring. However, it uses a push-based delivery model and stores messages primarily in memory. For banking workloads that require replay capability (replaying events to rebuild audit logs, recover from consumer bugs), Kafka's persistent log-based model is a significant advantage. RabbitMQ also lacks native support for consumer group rebalancing and partition-based ordering.
- **Amazon SQS:** Fully managed and operationally simple. However, it lacks the message ordering guarantees that are critical for the transaction saga (we need all events for a given transactionId to be processed in order by each consumer). SQS FIFO queues address ordering but at the cost of throughput and increased latency. SQS also does not support topic fan-out natively without pairing it with SNS, adding operational complexity.

---

## Decision

We will use **Apache Kafka** (via Confluent's Docker image, version 7.6.0) as the message broker for all asynchronous inter-service communication.

Services will publish domain events to well-defined Kafka topics. Other services subscribe to the topics they care about, independently and asynchronously. The `banking-network` Docker network connects all services; in production, Kafka will run as a managed service (Confluent Cloud or MSK).

**Key conventions established with this decision:**

1. Topics are named using the pattern `{domain}.{event-type}` (e.g., `transaction.initiated`, `account.status.changed`).
2. Every topic has a corresponding `.DLT` Dead Letter Topic for failed messages.
3. Messages within a topic are partitioned by a domain entity ID (e.g., `transactionId`, `accountId`) to guarantee ordering for events on the same entity.
4. All topic definitions are documented in `infrastructure/kafka/topics/topics.yaml`.
5. `auto.create.topics.enable=false` — topics must be explicitly created via the provisioning script.

---

## Consequences

### Positive

**Decoupling and independent evolution:** Services no longer need to know which other services consume their events. Adding a new consumer (e.g., a new analytics service) requires no changes to existing producers. Each service can be deployed, scaled, and updated independently.

**Fault isolation:** A failure in notification-service does not affect transaction processing. The notification-service will catch up from its last committed offset when it recovers. Non-critical services can fail without degrading the critical transaction path.

**Replay and recovery:** Kafka's durable log allows consumers to replay events from any offset. This is invaluable for:
- Bootstrapping a new service with historical data
- Recovering a service that had a bug and produced incorrect state
- Populating a new read model from existing events
- Debugging production issues by replaying events in a test environment

**Audit trail:** Every domain event is durably persisted in Kafka for the configured retention period (7 days for primary topics, 30 days for DLTs). This provides an independent, append-only record of all system activity, separate from the audit-service's database.

**Throughput and scalability:** Kafka partitions enable parallel consumption. Transaction topics use 12 partitions, allowing 12 consumer instances per consumer group to process events concurrently. Horizontal scaling is achieved by adding consumer instances up to the partition count.

### Negative

**Operational complexity:** Kafka adds a non-trivial piece of infrastructure. The team must understand consumer group rebalancing, offset management, partition assignment, and lag monitoring. Zookeeper (required by Kafka 7.6.0) adds another dependency, though future versions support KRaft mode without Zookeeper.

**Eventual consistency:** Downstream services see events after a small delay (typically milliseconds, but potentially longer under load). The account-service's local cache of account statuses (used to validate transactions) may be briefly stale. We accept this tradeoff and design for idempotency in all consumers.

**Debugging distributed flows:** A single logical operation (e.g., a transaction) now spans multiple services and multiple Kafka topics. Distributed tracing (OpenTelemetry) is essential for following a flow end-to-end. Without it, debugging production issues becomes significantly harder.

**Ordering is per-partition only:** We guarantee ordering only for messages with the same partition key (e.g., all events for a given transactionId are ordered). Events across different entities are not ordered relative to each other.

**Local development overhead:** Developers need Docker running with Kafka and Zookeeper to work on any service that publishes or consumes events. This is mitigated by the provided `docker-compose.yml` that starts the full infrastructure with a single command.

---

## References

- [Kafka Documentation](https://kafka.apache.org/documentation/)
- [Spring Kafka Reference Guide](https://docs.spring.io/spring-kafka/reference/)
- `infrastructure/kafka/topics/topics.yaml` — topic definitions
- `infrastructure/kafka/topics/create-topics.sh` — topic provisioning script
- ADR-0002: Saga Orchestration Pattern
- ADR-0003: Outbox Pattern for Reliable Event Publishing

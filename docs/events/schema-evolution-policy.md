# Kafka Schema Evolution Policy

**Platform:** Banking Platform — Java 21, Spring Boot 3.2.5, Apache Kafka, PostgreSQL 16  
**Serialization:** JSON (Jackson `ObjectMapper`)  
**Last Updated:** 2026-06-15  
**Owner:** Backend Engineering

---

## Table of Contents

1. [Overview and Guiding Principles](#1-overview-and-guiding-principles)
2. [The `version` Field](#2-the-version-field)
3. [Safe Changes (Non-Breaking / Additive)](#3-safe-changes-non-breaking--additive)
4. [Breaking Changes (Require Migration Strategy)](#4-breaking-changes-require-migration-strategy)
5. [The Dual-Publish Pattern](#5-the-dual-publish-pattern)
6. [Deprecation Process](#6-deprecation-process)
7. [Field Naming Conventions](#7-field-naming-conventions)
8. [Null Handling Policy](#8-null-handling-policy)
9. [Consumer Contract Tests](#9-consumer-contract-tests)
10. [Future Enhancement: Schema Registry](#10-future-enhancement-schema-registry)
11. [Active Migrations](#11-active-migrations)
12. [Completed Migrations](#12-completed-migrations)

---

## 1. Overview and Guiding Principles

### Why Schema Evolution Matters

In an event-driven banking platform, producers and consumers are independently deployable services. A Kafka topic is a durable, append-only log — once a message is written, it persists according to the topic's retention policy. This creates a fundamental asymmetry: **you can redeploy a consumer at any time, but you cannot retroactively rewrite messages already in the log**.

This means:

- A producer change that modifies a JSON field name immediately affects all consumers reading live messages, even if those consumers have not yet been redeployed.
- A consumer deployed before a producer change must still be able to process messages written under the old schema.
- A consumer deployed after a producer change must be able to process both old messages (from log replay) and new messages.

### The Cardinal Rule

> **Never remove or rename a field that any active consumer depends on without a documented migration strategy, a dual-publish period, and coordinated consumer updates.**

Violating this rule results in deserialization errors, messages being routed to the Dead Letter Topic (DLT), data loss, and potentially undetected silent failures (e.g., a field silently becoming `null` when a consumer did not null-check it).

### Default Compatibility Mode: BACKWARD

This platform enforces **BACKWARD compatibility** as the default stance for all schema changes:

- A new schema version must be able to correctly read data written with the old schema.
- Concretely: new fields are optional, old fields are never removed without a migration, and types are never narrowed.

This is not enforced by an automated schema registry (see [Section 10](#10-future-enhancement-schema-registry)) — it is enforced by code conventions, peer review gates, and the contract tests described in [Section 9](#9-consumer-contract-tests).

### Serialization Technology

All Kafka messages on this platform use **JSON serialization via Jackson `ObjectMapper`**. There is no Avro or Protobuf schema registry. Compatibility is ensured by:

- Configuring Jackson with `DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES = false` globally, so consumers silently ignore new fields they do not know about.
- Enforcing additive-only changes via PR review and contract tests.
- Using the `version` field on the `BaseEvent` envelope to signal breaking changes.

### Registered Kafka Topics and Events

| Event Class | Topic | Partition Key |
|---|---|---|
| `AccountCreatedEvent` | `account.created` | `accountId` |
| `AccountStatusChangedEvent` | `account.status.changed` | `accountId` |
| `TransactionInitiatedEvent` | `transaction.initiated` | `transactionId` |
| `TransactionProcessingEvent` | `transaction.processing` | `transactionId` |
| `TransactionCompletedEvent` | `transaction.completed` | `transactionId` |
| `TransactionFailedEvent` | `transaction.failed` | `transactionId` |
| `FraudDecisionEvent` | `fraud.decision` | `transactionId` |
| `FraudDetectedEvent` | `fraud.detected` | `transactionId` |
| `NotificationRequestedEvent` | `notification.requested` | `correlationId` |

---

## 2. The `version` Field

### BaseEvent Envelope

Every event published on this platform is wrapped in the `BaseEvent` envelope, which includes the following fields:

| Field | Type | Description |
|---|---|---|
| `eventId` | `UUID` | Globally unique identifier for this specific event instance |
| `eventType` | `enum` | Discriminator for the event type (e.g., `TRANSACTION_COMPLETED`) |
| `aggregateId` | `UUID` | ID of the domain aggregate this event belongs to |
| `aggregateType` | `String` | Name of the aggregate type (e.g., `"Transaction"`) |
| `correlationId` | `String` | Traces a request across multiple services |
| `causationId` | `String` | ID of the command or event that caused this event |
| `sourceService` | `String` | Name of the microservice that published this event |
| `occurredAt` | `Instant` | UTC timestamp when the event occurred |
| `version` | `int` | Schema version of this event payload (starts at `1`) |

### How `version` Works

The `version` field starts at `1` for all events. It is incremented **only when a breaking change is unavoidable** and a new event class (e.g., `TransactionCompletedEventV2`) has been created alongside the old one. Additive changes do **not** require a version bump.

The `version` field lives at the envelope level and is readable without deserializing the full event payload. This allows consumers to branch on version before committing to a specific deserialization target class.

### Consumer Branching Pattern

```java
@KafkaListener(topics = "transaction.completed")
public void handle(ConsumerRecord<String, String> record) {
    // Step 1: Read only the lightweight envelope to inspect version
    BaseEvent envelope = objectMapper.readValue(record.value(), BaseEvent.class);

    if (envelope.getVersion() == 1) {
        // Step 2a: Deserialize into the V1 POJO
        TransactionCompletedEventV1 event =
            objectMapper.readValue(record.value(), TransactionCompletedEventV1.class);
        handleV1(event);
    } else if (envelope.getVersion() == 2) {
        // Step 2b: Deserialize into the V2 POJO
        TransactionCompletedEventV2 event =
            objectMapper.readValue(record.value(), TransactionCompletedEventV2.class);
        handleV2(event);
    } else {
        // Step 2c: Unknown future version — log and skip, do not send to DLT
        log.warn("Unrecognized event version {} for eventId={}, skipping",
            envelope.getVersion(), envelope.getEventId());
    }
}
```

> **Important:** The `else` branch must **never throw** for unknown future versions. Throwing causes the message to be retried and eventually sent to the Dead Letter Topic, which is the wrong outcome for a forward-compatibility gap.

---

## 3. Safe Changes (Non-Breaking / Additive)

The following changes can be made without a migration strategy, a dual-publish period, or a version bump. They must still be reviewed by at least one other team lead and must not break contract tests.

### 3a. Adding a New Optional Field

**Description:** A new field is added to an existing event. Old consumers do not know about it; new consumers must handle the case where it is absent (i.e., `null`) when reading old messages from the log.

**Why it is safe:** Jackson is configured globally with `DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES = false`. Old consumers will deserialize the payload and silently ignore the new field. New consumers reading old messages will receive `null` for the field and must null-check it.

**Example:** Adding `ipAddress` to `TransactionInitiatedEvent`.

Before (v1 message in the log):

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "eventType": "TRANSACTION_INITIATED",
  "aggregateId": "a1b2c3d4-0000-0000-0000-000000000001",
  "aggregateType": "Transaction",
  "correlationId": "req-8821",
  "causationId": "cmd-4410",
  "sourceService": "transaction-service",
  "occurredAt": "2024-01-15T10:30:00.000Z",
  "version": 1,
  "transactionId": "txn-0042",
  "sourceAccountId": "acc-1001",
  "destinationAccountId": "acc-2002",
  "amount": "250.00",
  "currency": "USD"
}
```

After (new producer adds `ipAddress`):

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440001",
  "eventType": "TRANSACTION_INITIATED",
  "aggregateId": "a1b2c3d4-0000-0000-0000-000000000002",
  "aggregateType": "Transaction",
  "correlationId": "req-8822",
  "causationId": "cmd-4411",
  "sourceService": "transaction-service",
  "occurredAt": "2024-01-15T10:31:00.000Z",
  "version": 1,
  "transactionId": "txn-0043",
  "sourceAccountId": "acc-1001",
  "destinationAccountId": "acc-2002",
  "amount": "250.00",
  "currency": "USD",
  "ipAddress": "192.168.1.55"
}
```

**Consumer handling:**

```java
@JsonIgnoreProperties(ignoreUnknown = true)
public class TransactionInitiatedEvent extends BaseEvent {
    private String transactionId;
    private String sourceAccountId;
    private String destinationAccountId;
    private BigDecimal amount;
    private String currency;

    // New optional field — always null-check before use
    @JsonProperty("ipAddress")
    private String ipAddress; // May be null for messages produced before this field was added

    // Getters ...
}
```

**Required review checklist:**
- New field annotated with `@JsonProperty`
- Getter returns `Optional<String>` or caller null-checks before use
- Contract test golden file updated to include the new field
- A second "minimal" golden file (without the field) also passes deserialization

### 3b. Adding a New EventType Value (New Event)

**Description:** A brand-new event class and topic are introduced. Existing consumers on other topics are completely unaffected. Consumers on related topics that use a `switch` on `eventType` must handle unknown values with a `default` no-op.

**Why it is safe:** No existing message is altered. No existing consumer receives a new message unless it explicitly subscribes to the new topic.

**Deploy order:** Deploy consumer changes (with the `default` no-op) **before** the producer begins publishing the new event type. This prevents a window where the producer emits the new type but the consumer panics on the unrecognized value.

**Pattern — defensive eventType switch:**

```java
switch (envelope.getEventType()) {
    case TRANSACTION_COMPLETED -> handleCompleted(event);
    case TRANSACTION_FAILED    -> handleFailed(event);
    default -> log.debug("Ignoring unhandled eventType: {}", envelope.getEventType());
    // Do NOT throw here — adding new enum values must not break existing consumers
}
```

### 3c. Widening a Numeric Type

**Description:** A numeric field is widened to a larger type, for example `int` to `long`. Jackson handles this transparently as long as the value fits in the old type's range for old consumers.

**Why it is safe:** Jackson deserializes a JSON number `1500` into either `int` or `long` without error. Old consumers reading a `long`-valued field into an `int` field will succeed as long as the value does not overflow `Integer.MAX_VALUE` (2,147,483,647).

**Caution:** If the business domain requires values outside the `int` range (e.g., total account balances in cents exceeding 2.1 billion), coordinate with all consuming teams before the producer starts emitting values in the extended range.

### 3d. Adding a New Kafka Topic

**Description:** A completely new topic is created and a new producer begins publishing to it.

**Why it is safe:** Kafka consumers subscribe by topic name. No existing consumer subscribes to a new topic unless explicitly reconfigured. This change has zero impact on any existing consumer group.

**Steps:**
1. Provision the topic via infrastructure-as-code (Terraform/Helm) with appropriate partition count and replication factor.
2. Define the new event class extending `BaseEvent`.
3. Add a contract test golden file under `src/test/resources/contracts/`.
4. Document the new topic in the event registry table in Section 1.

---

## 4. Breaking Changes (Require Migration Strategy)

The following changes **break backward compatibility** and require the full dual-publish process described in [Section 5](#5-the-dual-publish-pattern) before the old format is removed.

### 4a. Removing a Field Consumers Depend On

**Description:** A field is deleted from the event JSON payload that one or more active consumers read.

**Why it breaks consumers:** When the field is absent from the JSON, Jackson sets it to `null` in the deserialized POJO. If the consumer does not null-check the field, a `NullPointerException` is thrown inside the listener method. Spring Kafka's `DefaultErrorHandler` retries the message up to the configured retry limit and then routes it to the Dead Letter Topic (`<topic-name>.DLT`).

**Silent failure risk:** If the consumer null-checks but uses a fallback default (e.g., `BigDecimal.ZERO` for `amount`), the business logic proceeds with incorrect data — potentially processing a zero-value transaction without an error signal. This is worse than a DLT failure.

**Required migration approach:**
1. Do not remove the field immediately. Keep publishing it in parallel.
2. Announce the deprecation (see [Section 6](#6-deprecation-process)).
3. All consumers must be updated to not depend on the field.
4. After all consumers are confirmed to no longer read the field, remove it from the producer.
5. Minimum migration window: **4 weeks (2 sprint cycles)**.

### 4b. Renaming a Field

**Description:** A field's JSON key name is changed (e.g., `amount` to `transactionAmount`).

**Why it breaks consumers:** Old consumers read the field by its old name (`amount`). When the producer emits `transactionAmount`, old consumers receive `null` for `amount` (field missing from JSON) and the new field `transactionAmount` is silently ignored as an unknown property. Old consumers fail silently or throw `NullPointerException`.

**Example:** Renaming `amount` to `transactionAmount` in `TransactionCompletedEvent`.

Before:

```json
{
  "transactionId": "txn-0042",
  "amount": "500.00",
  "currency": "USD",
  "status": "COMPLETED"
}
```

After (incorrect — breaks consumers immediately):

```json
{
  "transactionId": "txn-0042",
  "transactionAmount": "500.00",
  "currency": "USD",
  "status": "COMPLETED"
}
```

**Required migration approach — dual-field period:**

Step 1: Produce **both** fields simultaneously during the migration window.

```json
{
  "transactionId": "txn-0042",
  "amount": "500.00",
  "transactionAmount": "500.00",
  "currency": "USD",
  "status": "COMPLETED"
}
```

Step 2: Consumers update to read `transactionAmount`, with fallback to `amount` for old messages:

```java
@JsonProperty("transactionAmount")
private BigDecimal transactionAmount;

@JsonProperty("amount")
@Deprecated
private BigDecimal amount; // Fallback for messages produced before the rename

public BigDecimal resolvedAmount() {
    return transactionAmount != null ? transactionAmount : amount;
}
```

Step 3: After the 4-week dual-field period and all consumers updated, remove `amount` from the producer.

Step 4: Remove the fallback `amount` field from consumer POJOs in a follow-up cleanup PR.

### 4c. Changing a Field Type

**Description:** A field's JSON type is changed incompatibly — for example, `"retryCount": 3` (number) becomes `"retryCount": "THREE"` (string), or an ISO-8601 timestamp string becomes an epoch millisecond integer.

**Why it breaks consumers:** Jackson throws a `com.fasterxml.jackson.databind.exc.MismatchedInputException` during deserialization, causing the message to be retried and eventually routed to the DLT.

**Required migration approach:**
1. Increment `version` on the `BaseEvent` envelope.
2. Create a new POJO class (e.g., `TransactionCompletedEventV2`) with the new field type.
3. Implement the version-branching consumer pattern shown in [Section 2](#2-the-version-field).
4. Use the dual-publish pattern: produce both `version: 1` and `version: 2` messages during the migration window.
5. After all consumers handle v2, stop producing v1 messages.

### 4d. Changing the Partition Key Field

**Description:** The Kafka message key used for partitioning is changed (e.g., from `transactionId` to `sourceAccountId` on the `transaction.completed` topic).

**Why it breaks consumers:** Kafka guarantees ordering only within a single partition. Changing the partition key means:
- Existing in-flight messages for a `transactionId` are on one partition.
- New messages for the same `transactionId` land on a different partition (because the key changed).
- Consumers processing both partitions will see these messages out of order, breaking state machines and idempotency checks.

**This is the riskiest change on this list.** It cannot be mitigated by dual-publish on the same topic — the ordering guarantee is inherently broken once different partition keys coexist in the same topic.

**Required migration approach:**
1. Schedule a **planned maintenance window** — coordinate with SRE and product.
2. Stop all producers for the affected topic.
3. Wait for all consumer groups to reach **zero lag** on the topic:
   ```bash
   kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
     --describe --group <consumer-group-id>
   ```
4. Update producers to use the new partition key.
5. Deploy and restart all consumers.
6. Resume producers.
7. Monitor consumer lag and error rates for at least 24 hours post-restart.

### 4e. Removing an Entire Event Type (Deprecating a Topic)

**Description:** A Kafka topic is decommissioned and its producer is removed.

**Why it breaks consumers:** Any active consumer subscribed to the topic will stop receiving events. If the consumer's business process depends on those events (e.g., `fraud-service` consuming `transaction.initiated`), the service will silently stop functioning.

**Required migration approach:**
1. Identify all consumer groups subscribed to the topic:
   ```bash
   kafka-consumer-groups.sh --bootstrap-server kafka:9092 --list \
     | xargs -I{} kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
       --describe --group {} \
     | grep "topic-name"
   ```
2. Decommission all consuming services or redirect them to an alternative data source first.
3. Confirm **zero consumer lag** across all consumer groups on the topic.
4. Remove the producer.
5. Set topic retention to the minimum allowed, then delete the topic after the retention window expires.
6. Remove the topic from the event registry table in Section 1.

---

## 5. The Dual-Publish Pattern

The dual-publish pattern is the standard migration mechanism for all breaking changes. It ensures zero-downtime schema migration by running old and new formats in parallel until all consumers have been upgraded.

### Migration Phases

**Phase 1 — Announce (Day 0)**
- Post in `#backend-engineering` Slack channel with the proposed change, affected topic(s), and timeline.
- Open a migration ticket in the project tracker with label `schema-migration`.
- Identify all consumer services via the event registry and code search:
  ```bash
  grep -r "transaction.completed" --include="*.java" --include="*.yml" -l
  ```
- Tag the consumer team leads in the migration ticket for acknowledgment within 48 hours.

**Phase 2 — Consumer Updates (Week 1–2)**
- Each consuming service updates its listener to handle both the old and the new schema format.
- For version-based branching, implement the pattern from [Section 2](#2-the-version-field).
- For dual-field renames, implement the fallback accessor pattern from [Section 4b](#4b-renaming-a-field).
- All updated consumers must pass contract tests for both old and new payload formats.

**Phase 3 — Deploy Consumers (Week 2–4)**
- Deploy all consumer changes across all environments (dev → staging → production).
- Verify no increase in DLT message counts after each deployment.
- Do not proceed to Phase 4 until **all** consumer services are deployed in production.

**Phase 4 — Enable Dual-Publish (Week 4)**
- The producer is updated to publish messages in both the old and the new format.
- For a version bump: publish to the same topic with both `version: 1` and `version: 2`.
- For a topic rename: publish to both the old topic and the new topic simultaneously.

```java
// During migration period — producer publishes in both formats
public void publishTransactionCompleted(TransactionCompletedEvent event) {
    // Publish v1 format on the original topic for legacy consumers still on old code
    TransactionCompletedEventV1 v1 = mapper.toV1(event);
    kafkaTemplate.send("transaction.completed", event.getTransactionId(), v1);

    // Publish v2 format on the new topic for upgraded consumers
    kafkaTemplate.send("transaction.completed.v2", event.getTransactionId(), event);
}
```

**Phase 5 — Monitor (Week 4–6)**
- Monitor consumer lag on both the old and the new topic/version via Kafka tooling and dashboards.
- Verify that upgraded consumers are correctly processing messages in the new format.
- Confirm no errors, retries, or DLT routing attributable to the schema change.
- Minimum observation window: **2 weeks** before proceeding to Phase 6.

**Phase 6 — Retire Old Format (Week 6+)**
- Stop dual-publishing the old format in the producer.
- Remove the old-format handling code from consumers in follow-up PRs (cleanup).
- Update the migration status to `COMPLETED` in [Section 12](#12-completed-migrations).
- Close the migration ticket.

### Dual-Publish Rollback

If consumer errors spike after enabling dual-publish (Phase 4), immediately stop publishing the new format and revert the producer to the old format only. Investigate the consumer errors before retrying Phase 4.

---

## 6. Deprecation Process

Follow these steps in order for every breaking schema change. Skipping steps requires explicit approval from the Engineering Lead.

1. **Open a migration issue** in the project tracker with:
   - Label: `schema-migration`
   - Title format: `[Schema Migration] <Event> — <description of change>`
   - Body: affected topic, affected consumer services, and proposed timeline

2. **Announce in `#backend-engineering`** Slack channel with:
   - The migration issue link
   - The affected event and topic
   - The 4-week deprecation timeline
   - A call for consuming teams to acknowledge within 48 hours

3. **Document the change** in this policy file under the [Active Migrations](#11-active-migrations) section, adding a row to the table with status `IN_PROGRESS`.

4. **Implement dual-publish in the producer** via a PR that:
   - Is labeled `schema-migration` in the PR tracker
   - References the migration issue number
   - Is reviewed by the consumer team leads (not only the producer team)

5. **All consuming services update** to handle the new schema alongside the old schema. Each update must:
   - Pass existing contract tests
   - Add new contract tests for the new schema format
   - Be reviewed by the consuming team lead

6. **Dual-publish runs for a minimum of 2 sprint cycles (4 weeks)** in production before proceeding.

7. **Confirm all consumer groups** have consumed messages in the new format:
   ```bash
   # Check consumer lag — must be 0 on both old and new topic/version
   kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
     --describe --group <consumer-group-id>
   ```

8. **Remove the old format from the producer** via a separate PR labeled `schema-migration-cleanup`.

9. **Remove old format handling from consumers** in follow-up PRs per service. These are low-risk cleanups and can be batched with regular sprint work.

10. **Update this document**: move the migration row from [Active Migrations](#11-active-migrations) to [Completed Migrations](#12-completed-migrations) with the completion date and any relevant notes.

---

## 7. Field Naming Conventions

Consistent naming prevents the most common class of accidental breaking changes — a field renamed by habit or refactor without realizing consumers depend on the original name.

### JSON Field Names: camelCase

All JSON field names use `camelCase`, consistent with Java field names and Jackson's default serialization behavior (`PropertyNamingStrategies.LOWER_CAMEL_CASE`).

| Correct | Incorrect |
|---|---|
| `sourceAccountId` | `source_account_id` |
| `occurredAt` | `occurred_at` |
| `transactionId` | `TransactionId` |
| `fraudDecisionReason` | `fraud-decision-reason` |

### UUID Fields

Serialized as a lowercase hyphenated string. Never as a raw integer or unformatted hex blob.

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "aggregateId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

Jackson serializes `UUID` as a hyphenated string by default — no extra configuration is needed.

### Timestamps: ISO-8601 in UTC

All `Instant` fields are serialized as ISO-8601 strings in UTC. Never as epoch milliseconds.

```json
{
  "occurredAt": "2024-01-15T10:30:00.000Z"
}
```

Required Jackson module registration:

```java
objectMapper.registerModule(new JavaTimeModule());
objectMapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
```

### Monetary Amounts: BigDecimal as String

To avoid IEEE 754 floating-point precision loss in JSON parsers that use `double`, all monetary amounts are serialized as JSON strings, not JSON numbers.

```json
{
  "amount": "150.75",
  "feeAmount": "2.50",
  "netAmount": "148.25"
}
```

Jackson annotation on the POJO field:

```java
@JsonSerialize(using = ToStringSerializer.class)
@JsonDeserialize(using = BigDecimalDeserializer.class)
private BigDecimal amount;
```

Consumers must deserialize these fields as `BigDecimal`, never as `double` or `float`.

### Enum Values: SCREAMING_SNAKE_CASE

All enum values use `SCREAMING_SNAKE_CASE`, matching Java enum constant conventions.

```json
{
  "eventType": "TRANSACTION_COMPLETED",
  "decision": "MANUAL_REVIEW",
  "accountStatus": "SUSPENDED_PENDING_REVIEW"
}
```

### Boolean Fields

Use the `is` prefix only for genuinely boolean state fields. Do not use it for status or classification fields where multiple non-boolean states exist.

| Correct | Incorrect |
|---|---|
| `"isHighRisk": true` | `"highRisk": true` (acceptable but inconsistent) |
| `"accountStatus": "ACTIVE"` | `"isActive": true` (loses information — there are multiple non-active states) |
| `"isRetry": false` | `"retry": false` (ambiguous — noun or adjective?) |

---

## 8. Null Handling Policy

### Rule 1: Use `null` for Absent Optional Fields

Never substitute empty string `""` or numeric zero `0` for a logically absent value.

| Scenario | Correct | Incorrect |
|---|---|---|
| Optional string not set | `"ipAddress": null` or field omitted | `"ipAddress": ""` |
| Optional integer not set | `"retryCount": null` or field omitted | `"retryCount": 0` |
| Optional amount not applicable | `"feeAmount": null` or field omitted | `"feeAmount": "0.00"` |

Using `""` or `0` as null substitutes forces all consumers to add domain-knowledge checks (`if (amount.compareTo(BigDecimal.ZERO) == 0)`) instead of a simple null check. Different teams will interpret the sentinel differently, leading to silent data bugs.

### Rule 2: Jackson Null Field Omission (Producer Side)

The global Jackson configuration omits null fields from serialized JSON to reduce message size:

```java
objectMapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
```

This means an absent optional field is **not present in the JSON at all**, rather than appearing as `"field": null`. Consumers must handle both the key-absent case and the explicit `null` case identically — they are semantically equivalent.

### Rule 3: Null-Safe Primitive Deserialization (Consumer Side)

Configure Jackson to not fail when a numeric primitive field is absent in the JSON (which would otherwise default to `0` with no warning):

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES, false);
```

Prefer nullable wrapper types (`Integer`, `Long`, `BigDecimal`) over Java primitives (`int`, `long`, `double`) for all optional numeric fields in event POJOs. Primitives cannot represent absence.

### Rule 4: Document Field Optionality

Every event class must have Javadoc indicating which fields are required vs. optional:

```java
/**
 * Published when a fraud assessment decision is made for a transaction.
 *
 * <p>Required fields: eventId, eventType, aggregateId, aggregateType,
 *    correlationId, sourceService, occurredAt, version, transactionId, decision
 *
 * <p>Optional fields:
 *   - reviewerId: present only when decision = MANUAL_REVIEW
 *   - ruleId: present only when decision = AUTO_DECLINED or AUTO_APPROVED
 *   - riskScore: always present as of schema v1
 */
public class FraudDecisionEvent extends BaseEvent { ... }
```

### Rule 5: Consumer Null-Check Requirement

All consumers must explicitly null-check optional fields before use. A consumer that assumes a field is non-null and throws `NullPointerException` violates this policy. Such violations are caught by contract tests that include payloads with the optional field absent (the "minimal" golden file pattern described in Section 9).

---

## 9. Consumer Contract Tests

### Purpose

Contract tests are the primary enforcement mechanism for schema compatibility in the absence of a schema registry. They ensure that a consumer service can correctly deserialize a known-good payload, and that a producer change that would break that deserialization is caught in CI before it reaches production.

### Structure

Each consuming service maintains contract test golden files under:

```
src/test/resources/contracts/
  transaction-completed-v1.json          # Full payload with all fields
  transaction-completed-v1-minimal.json  # Payload with only required fields
  transaction-failed-v1.json
  fraud-decision-v1.json
  fraud-decision-v1-manual-review.json   # Variant: reviewerId present
  ...
```

Each golden file is a realistic, complete JSON payload representing the event as published by the producer. It is **checked into source control** and reviewed alongside any schema change PR.

### Example Contract Test

```java
@SpringBootTest
class TransactionCompletedEventContractTest {

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void shouldDeserializeTransactionCompletedEvent() throws Exception {
        String payload = Files.readString(
            Path.of("src/test/resources/contracts/transaction-completed-v1.json")
        );

        TransactionCompletedEvent event =
            objectMapper.readValue(payload, TransactionCompletedEvent.class);

        assertThat(event.getEventId()).isNotNull();
        assertThat(event.getTransactionId()).isNotNull();
        assertThat(event.getAmount()).isPositive();
        assertThat(event.getOccurredAt()).isBefore(Instant.now().plusSeconds(60));
        assertThat(event.getVersion()).isEqualTo(1);
    }

    @Test
    void shouldDeserializeTransactionCompletedEventWithMissingOptionalFields() throws Exception {
        // Golden file with optional fields absent — tests backward compatibility
        String payload = Files.readString(
            Path.of("src/test/resources/contracts/transaction-completed-v1-minimal.json")
        );

        TransactionCompletedEvent event =
            objectMapper.readValue(payload, TransactionCompletedEvent.class);

        assertThat(event.getTransactionId()).isNotNull();
        // Optional field: must not throw, must return null gracefully
        assertThat(event.getIpAddress()).isNull();
    }
}
```

### CI Enforcement

Contract tests run as part of the standard `./mvnw test` gate on every pull request. A PR that breaks a contract test **must not be merged** until:

1. The contract test golden file is updated with the new payload format, **and**
2. The consuming team has been notified and has explicitly acknowledged the change.

### Producer Responsibility

When a producer team proposes a schema change:

1. Update the golden files in the **consumer service repositories** (not only the producer repo).
2. Open PRs in the consumer repos with the updated golden files and a reference to the migration ticket number.
3. Request review from the consumer team leads.
4. Do not merge the producer-side PR until all consumer-side golden file PRs are approved.

---

## 10. Future Enhancement: Schema Registry

### Current State

Schema compatibility is enforced today through:
- Code conventions (this document)
- Jackson configuration (`FAIL_ON_UNKNOWN_PROPERTIES = false`, `NON_NULL` serialization inclusion)
- Consumer contract tests with golden files in CI
- PR review gates requiring consumer team lead sign-off on all schema changes

### Planned Future Enhancement

As the platform grows, manual coordination becomes the bottleneck. The following schema registry options are under evaluation:

| Option | Pros | Cons |
|---|---|---|
| Confluent Schema Registry | Native Kafka integration, mature tooling, supports Avro/Protobuf/JSON Schema | Requires Confluent Platform or separate service deployment |
| AWS Glue Schema Registry | Fully managed, integrates with MSK | AWS-specific, less community tooling |
| Apicurio Registry | Open-source, supports multiple formats, REST API | Less tooling maturity compared to Confluent |

### When to Adopt

Trigger adoption when either condition is met:
- The platform grows beyond **5 independently deployable services** consuming Kafka events.
- The rate of schema changes exceeds **3 per sprint**, indicating friction that automated enforcement would reduce.

### Migration Path to Schema Registry

1. Introduce the schema registry alongside existing JSON topics — do not migrate all topics at once.
2. Register JSON schemas (JSON Schema Draft-07) for existing events without changing the wire format.
3. Enable `BACKWARD` compatibility mode in the registry — this enforces the same policy already documented here, but automatically on every producer commit.
4. Pilot the registry on one low-traffic topic (e.g., `notification.requested`) before rolling out platform-wide.
5. Evaluate migration to Avro or Protobuf only if binary encoding performance becomes measurably necessary for throughput — JSON with schema enforcement is sufficient for most banking workloads at current scale.

---

## 11. Active Migrations

The table below tracks in-progress schema migrations. Add a row when a migration begins (Phase 1 of the deprecation process). Remove the row and add it to [Completed Migrations](#12-completed-migrations) when Phase 6 is complete.

| Migration ID | Field Changed | Event | Status | Started | Target Completion | Owner |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

*No active migrations at this time.*

---

## 12. Completed Migrations

The table below is an append-only audit trail of all completed schema migrations. Do not delete rows.

| Migration ID | Change Description | Event | Completed Date | Notes |
|---|---|---|---|---|
| — | — | — | — | — |

*No completed migrations recorded yet.*

---

## Appendix A: Change Classification Quick Reference

| Change Type | Breaking? | Requires Version Bump? | Requires Dual-Publish? | Requires Maintenance Window? |
|---|---|---|---|---|
| Add optional field | No | No | No | No |
| Add new topic | No | No | No | No |
| Add new enum value | No | No | No | No |
| Widen numeric type | No | No | No | No |
| Remove field consumers use | Yes | Recommended | Yes | No |
| Rename a field | Yes | Recommended | Yes | No |
| Change field type | Yes | Yes | Yes | No |
| Change partition key | Yes | No | No | Yes |
| Deprecate entire topic | Yes | No | No | No (but coordinate carefully) |

### Key Jackson Configuration Checklist

```java
objectMapper
    // Silently ignore new fields unknown to the consumer — core backward compat mechanism
    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
    // Tolerate absent numeric fields without throwing
    .configure(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES, false)
    // Omit null fields from JSON output to reduce message size
    .setSerializationInclusion(JsonInclude.Include.NON_NULL)
    // Register JavaTimeModule for Instant/LocalDate support
    .registerModule(new JavaTimeModule())
    // Serialize Instant as ISO-8601 string, not epoch millis
    .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
```

## Appendix B: Emergency Contacts

For urgent schema compatibility questions or production DLT incidents related to schema changes, contact the Backend Engineering on-call engineer via PagerDuty, or post in `#backend-incidents` with the tag `@backend-oncall`.

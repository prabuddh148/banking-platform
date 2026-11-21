# Event Schema Evolution Policy

Events are JSON without a schema registry, so the rules below are what keep producers and consumers
compatible. Every event carries `schemaVersion` (currently `1`, from `BaseEvent.CURRENT_SCHEMA_VERSION`).

## 1. Compatibility goal

**Backward and forward compatible within a schema version**:
- New consumers can read old events (still in Kafka, the outbox, or a DLT replay).
- Old consumers can read new events (during a rolling deploy).

## 2. Rules for consumers (tolerant reader)

1. Ignore unknown fields. `BaseEvent` has `@JsonIgnoreProperties(ignoreUnknown = true)`; consumers
   that read `JsonNode` simply don't look at extra fields.
2. Ignore unknown `eventType` values.
3. Treat new optional fields as possibly missing (null) and use a sensible default.
4. Never fail on an unexpected enum value in a field you don't need; log a warning instead.

## 3. Allowed changes (no version bump)

| Change | Example |
|--------|---------|
| Add an optional field | add `channel` to `TRANSACTION_COMPLETED` |
| Add a new event type to a topic | add `ACCOUNT_UPDATED` |
| Add a new value to an enum field **if consumers tolerate it** | new `errorCode` value |
| Make a field nullable that consumers already handle as nullable | |

## 4. Breaking changes (need a new version)

- Removing or renaming a field.
- Changing a field's type or meaning (e.g. `amount` in paise instead of rupees).
- Changing the key (`aggregateId`) of an event.
- Making a previously optional field required for consumers.

### How to make a breaking change

1. Bump `schemaVersion` for that event type (e.g. to `2`).
2. **Consumers first**: deploy consumers that understand both v1 and v2 (switch on `schemaVersion`).
3. **Producers next**: start publishing v2.
4. Keep v1 support until no v1 events can appear anymore: older than Kafka retention (7 days), no
   `PENDING`/`FAILED` v1 rows in the outbox, and no v1 messages in DLTs (30 days).
5. Remove v1 handling.

Alternative for big changes: introduce a **new event type** (e.g. `TRANSACTION_COMPLETED_V2`) and
retire the old one with the same steps.

## 5. Documentation

- The [event catalog](event-catalog.md) is the contract. Update it in the same PR as the code.
- Infrastructure JSON schemas, when present, live in `infrastructure/kafka/schemas/`.
- Event classes live in each producer service (extending `BaseEvent`); `EventType` and topic names
  live in common-library.

## 6. Money and time formats (never change)

- Amounts: JSON number with 2 decimals (`BigDecimal`, scale 2). Never floats in code, never strings.
- Currency: ISO-4217 code string.
- Time: ISO-8601 UTC instant string (`2026-11-21T11:00:00Z`), never epoch numbers
  (`write-dates-as-timestamps: false`).
- Ids: strings (UUIDs or business ids like `CUST-1001`).

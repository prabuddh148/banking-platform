package com.banking.common.event;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

import java.time.Instant;
import java.util.UUID;

/**
 * Fields every Kafka event carries. Concrete events extend this and add their own payload fields.
 * Events are sent as JSON strings; the Kafka message key is {@link #aggregateId}.
 */
@Getter
@Setter
@ToString
@NoArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public abstract class BaseEvent {

    public static final int CURRENT_SCHEMA_VERSION = 1;

    /** Unique id of this event (used by consumers for de-duplication). */
    private String eventId;
    private EventType eventType;
    /** Id of the thing the event is about, e.g. accountId or transactionId. */
    private String aggregateId;
    private Instant occurredAt;
    /** Ties together all events of one business flow (e.g. one transfer). */
    private String correlationId;
    /** Name of the service that produced the event. */
    private String source;
    private int schemaVersion;

    protected BaseEvent(EventType eventType, String aggregateId, String correlationId, String source) {
        this.eventId = UUID.randomUUID().toString();
        this.eventType = eventType;
        this.aggregateId = aggregateId;
        this.occurredAt = Instant.now();
        this.correlationId = correlationId != null ? correlationId : UUID.randomUUID().toString();
        this.source = source;
        this.schemaVersion = CURRENT_SCHEMA_VERSION;
    }

    /** Topic this event should be published to. */
    public String topic() {
        return eventType.getTopic();
    }
}

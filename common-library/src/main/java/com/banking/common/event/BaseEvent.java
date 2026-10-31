package com.banking.common.event;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Getter
@Setter
@NoArgsConstructor
public abstract class BaseEvent {

    public static final int CURRENT_SCHEMA_VERSION = 1;

    private String eventId;

    private EventType eventType;

    private String aggregateId;

    private Instant occurredAt;

    private String correlationId;

    private int schemaVersion;

    protected BaseEvent(EventType eventType, String aggregateId, String correlationId) {
        this.eventId = UUID.randomUUID().toString();
        this.eventType = eventType;
        this.aggregateId = aggregateId;
        this.correlationId = correlationId;
        this.occurredAt = Instant.now();
        this.schemaVersion = CURRENT_SCHEMA_VERSION;
    }

    @JsonIgnore
    public String getTopic() {
        return eventType.getTopic();
    }
}

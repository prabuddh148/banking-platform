package com.banking.audit.dto.response;

import com.banking.audit.entity.AuditEventType;
import com.banking.audit.entity.AuditSeverity;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * One audit log entry as returned by the REST API.
 * {@code details} is returned as a JSON object (already masked), not as a string.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AuditLogResponse {
    private UUID id;
    private String eventId;
    private AuditEventType eventType;
    private String aggregateId;
    private String aggregateType;
    private String actor;
    private String action;
    private AuditSeverity severity;
    private String sourceService;
    private String correlationId;
    private JsonNode details;
    private Instant occurredAt;
    private Instant recordedAt;
}

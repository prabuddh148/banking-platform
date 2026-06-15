package com.banking.audit.dto.response;

import com.banking.audit.entity.AuditEventType;
import com.banking.audit.entity.AuditSeverity;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AuditLogResponse {

    private UUID id;
    private AuditEventType eventType;
    private AuditSeverity severity;
    private UUID actorId;
    private String actorType;
    private String resourceType;
    private UUID resourceId;
    private String action;
    private String description;
    private String sourceService;
    private String correlationId;
    private Instant occurredAt;
    private Instant recordedAt;
}

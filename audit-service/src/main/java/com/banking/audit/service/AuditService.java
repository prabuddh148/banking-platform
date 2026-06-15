package com.banking.audit.service;

import com.banking.audit.dto.response.AuditLogResponse;
import com.banking.audit.entity.AuditEventType;
import com.banking.audit.entity.AuditLog;
import com.banking.audit.entity.AuditSeverity;
import com.banking.common.dto.PagedResponse;

import java.time.Instant;
import java.util.UUID;

public interface AuditService {

    AuditLogResponse recordEvent(AuditLog auditLog);

    AuditLogResponse getAuditLog(UUID id);

    PagedResponse<AuditLogResponse> getAuditLogsByResource(UUID resourceId, int page, int size);

    PagedResponse<AuditLogResponse> getAuditLogsByActor(UUID actorId, int page, int size);

    PagedResponse<AuditLogResponse> getAuditLogsByService(String service, int page, int size);

    PagedResponse<AuditLogResponse> getAuditLogsByEventType(AuditEventType eventType, Instant from, Instant to, int page, int size);

    PagedResponse<AuditLogResponse> getAuditLogsBySeverity(AuditSeverity severity, int page, int size);
}

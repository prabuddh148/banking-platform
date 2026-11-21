package com.banking.audit.service;

import com.banking.audit.dto.response.AuditLogResponse;
import com.banking.audit.dto.response.AuditSummaryResponse;
import com.banking.audit.entity.AuditEventType;
import com.banking.audit.entity.AuditSeverity;
import com.banking.common.dto.PagedResponse;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.data.domain.Pageable;

import java.time.Instant;
import java.util.UUID;

/**
 * Records platform events as audit logs and lets admins search them.
 */
public interface AuditService {

    /**
     * Stores one Kafka event as an audit log.
     *
     * @param event the event JSON (BaseEvent fields + payload)
     * @return true if a new row was written, false if the event was already recorded (duplicate)
     * @throws IllegalArgumentException if the message is not a JSON object or has no eventId
     */
    boolean recordEvent(JsonNode event);

    /** Search with optional filters (null = no filter). */
    PagedResponse<AuditLogResponse> getAuditLogs(AuditEventType eventType, String aggregateId, String actor,
                                                 AuditSeverity severity, Instant from, Instant to,
                                                 Pageable pageable);

    /** @throws com.banking.common.exception.BankingException AUDIT_LOG_NOT_FOUND */
    AuditLogResponse getAuditLog(UUID id);

    PagedResponse<AuditLogResponse> getAuditLogsByAggregate(String aggregateId, Pageable pageable);

    PagedResponse<AuditLogResponse> getAuditLogsByActor(String actor, Pageable pageable);

    PagedResponse<AuditLogResponse> getAuditLogsByCorrelation(String correlationId, Pageable pageable);

    /**
     * Counts per event type and severity between {@code from} and {@code to}.
     * Defaults: {@code to} = now, {@code from} = 30 days before {@code to}.
     */
    AuditSummaryResponse getSummary(Instant from, Instant to);
}

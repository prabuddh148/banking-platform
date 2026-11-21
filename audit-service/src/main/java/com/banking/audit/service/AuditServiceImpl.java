package com.banking.audit.service;

import com.banking.audit.dto.response.AuditLogResponse;
import com.banking.audit.dto.response.AuditSummaryResponse;
import com.banking.audit.entity.AuditEventType;
import com.banking.audit.entity.AuditLog;
import com.banking.audit.entity.AuditSeverity;
import com.banking.audit.mapper.AuditLogMapper;
import com.banking.audit.repository.AuditLogRepository;
import com.banking.audit.util.AuditLogFormatter;
import com.banking.common.dto.PagedResponse;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Default {@link AuditService}.
 * <p>
 * Recording an event, step by step:
 * <ol>
 *   <li>Check the message is a JSON object with an eventId (otherwise it can never be stored -> DLT).</li>
 *   <li>Skip it if that eventId is already stored (Kafka may deliver the same message twice).</li>
 *   <li>Work out event type, aggregate type, actor and severity.</li>
 *   <li>Build the readable action text and the masked details JSON.</li>
 *   <li>Insert the row.</li>
 * </ol>
 * The unique constraint on event_id is the final safety net: if two copies of an event race past the
 * duplicate check, the second insert fails, Kafka retries it, and the retry is skipped as a duplicate.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AuditServiceImpl implements AuditService {

    static final String SYSTEM_ACTOR = "system";
    /** Payload fields that identify who caused an event, checked in this order. */
    private static final List<String> ACTOR_FIELDS = List.of("initiatedBy", "changedBy", "reviewedBy", "customerId");
    private static final Duration DEFAULT_SUMMARY_WINDOW = Duration.ofDays(30);

    private final AuditLogRepository auditLogRepository;
    private final AuditLogMapper auditLogMapper;
    private final AuditLogFormatter formatter;

    // ================================================================== recording

    @Override
    @Transactional
    public boolean recordEvent(JsonNode event) {
        if (event == null || !event.isObject()) {
            throw new IllegalArgumentException("Audit event must be a JSON object");
        }
        String eventId = text(event, "eventId");
        if (eventId == null) {
            throw new IllegalArgumentException("Audit event has no eventId");
        }
        if (auditLogRepository.existsByEventId(eventId)) {
            log.info("Event {} already recorded - skipping duplicate", eventId);
            return false;
        }

        String rawEventType = text(event, "eventType");
        AuditEventType eventType = AuditEventType.fromName(rawEventType);
        if (eventType == AuditEventType.UNKNOWN) {
            log.warn("Recording event {} with unknown eventType '{}'", eventId, rawEventType);
        }

        AuditLog auditLog = AuditLog.builder()
                .eventId(eventId)
                .eventType(eventType)
                .rawEventType(rawEventType)
                .aggregateId(text(event, "aggregateId"))
                .aggregateType(eventType.getAggregateType())
                .actor(resolveActor(event))
                .action(formatter.buildAction(eventType, event))
                .severity(resolveSeverity(eventType, event))
                .sourceService(text(event, "source"))
                .correlationId(text(event, "correlationId"))
                .details(formatter.buildDetails(event))
                .occurredAt(parseInstant(event.get("occurredAt")))
                // Also set by JPA auditing (@CreatedDate); set here so the value is never null.
                .recordedAt(Instant.now())
                .build();

        auditLogRepository.save(auditLog);
        log.debug("Recorded audit log for event {} ({}, severity {})", eventId, eventType, auditLog.getSeverity());
        return true;
    }

    /** First non-blank of initiatedBy / changedBy / reviewedBy / customerId, else "system". */
    String resolveActor(JsonNode event) {
        for (String field : ACTOR_FIELDS) {
            String value = text(event, field);
            if (value != null) {
                return value;
            }
        }
        return SYSTEM_ACTOR;
    }

    /**
     * FRAUD_DETECTED: CRITICAL when the transaction was blocked, otherwise WARNING (waiting for review).
     * Failures and account status changes: WARNING. Everything else: INFO.
     */
    AuditSeverity resolveSeverity(AuditEventType type, JsonNode event) {
        return switch (type) {
            case FRAUD_DETECTED -> "BLOCK".equalsIgnoreCase(text(event, "decision"))
                    ? AuditSeverity.CRITICAL : AuditSeverity.WARNING;
            case TRANSACTION_FAILED, BALANCE_UPDATE_FAILED, ACCOUNT_STATUS_CHANGED -> AuditSeverity.WARNING;
            default -> AuditSeverity.INFO;
        };
    }

    /** Accepts ISO-8601 text ("2024-05-01T10:15:30Z") or epoch seconds; falls back to now. */
    private static Instant parseInstant(JsonNode node) {
        if (node == null || node.isNull()) {
            return Instant.now();
        }
        try {
            if (node.isNumber()) {
                BigDecimal seconds = node.decimalValue();
                long wholeSeconds = seconds.longValue();
                int nanos = seconds.subtract(BigDecimal.valueOf(wholeSeconds)).movePointRight(9).intValue();
                return Instant.ofEpochSecond(wholeSeconds, nanos);
            }
            return Instant.parse(node.asText());
        } catch (DateTimeParseException | ArithmeticException e) {
            log.warn("Could not parse occurredAt '{}', using current time", node);
            return Instant.now();
        }
    }

    private static String text(JsonNode event, String field) {
        JsonNode value = event.get(field);
        if (value == null || value.isNull() || value.asText().isBlank()) {
            return null;
        }
        return value.asText();
    }

    // ================================================================== queries

    @Override
    @Transactional(readOnly = true)
    public PagedResponse<AuditLogResponse> getAuditLogs(AuditEventType eventType, String aggregateId, String actor,
                                                        AuditSeverity severity, Instant from, Instant to,
                                                        Pageable pageable) {
        validateRange(from, to);
        var spec = AuditLogRepository.filter(eventType, aggregateId, actor, severity, from, to);
        return PagedResponse.from(auditLogRepository.findAll(spec, pageable), auditLogMapper::toResponse);
    }

    @Override
    @Transactional(readOnly = true)
    public AuditLogResponse getAuditLog(UUID id) {
        return auditLogRepository.findById(id)
                .map(auditLogMapper::toResponse)
                .orElseThrow(() -> new BankingException(ErrorCode.AUDIT_LOG_NOT_FOUND,
                        "Audit log not found: " + id));
    }

    @Override
    @Transactional(readOnly = true)
    public PagedResponse<AuditLogResponse> getAuditLogsByAggregate(String aggregateId, Pageable pageable) {
        return PagedResponse.from(auditLogRepository.findByAggregateId(aggregateId, pageable),
                auditLogMapper::toResponse);
    }

    @Override
    @Transactional(readOnly = true)
    public PagedResponse<AuditLogResponse> getAuditLogsByActor(String actor, Pageable pageable) {
        return PagedResponse.from(auditLogRepository.findByActor(actor, pageable), auditLogMapper::toResponse);
    }

    @Override
    @Transactional(readOnly = true)
    public PagedResponse<AuditLogResponse> getAuditLogsByCorrelation(String correlationId, Pageable pageable) {
        return PagedResponse.from(auditLogRepository.findByCorrelationId(correlationId, pageable),
                auditLogMapper::toResponse);
    }

    @Override
    @Transactional(readOnly = true)
    public AuditSummaryResponse getSummary(Instant from, Instant to) {
        Instant end = to != null ? to : Instant.now();
        Instant start = from != null ? from : end.minus(DEFAULT_SUMMARY_WINDOW);
        validateRange(start, end);

        // Start with 0 for every value so the dashboard always gets the full list.
        Map<AuditEventType, Long> byType = new EnumMap<>(AuditEventType.class);
        for (AuditEventType type : AuditEventType.values()) {
            byType.put(type, 0L);
        }
        for (Object[] row : auditLogRepository.countByEventType(start, end)) {
            byType.put((AuditEventType) row[0], ((Number) row[1]).longValue());
        }

        Map<AuditSeverity, Long> bySeverity = new EnumMap<>(AuditSeverity.class);
        for (AuditSeverity severity : AuditSeverity.values()) {
            bySeverity.put(severity, 0L);
        }
        for (Object[] row : auditLogRepository.countBySeverity(start, end)) {
            bySeverity.put((AuditSeverity) row[0], ((Number) row[1]).longValue());
        }

        return AuditSummaryResponse.builder()
                .totalEvents(auditLogRepository.countInRange(start, end))
                .countsByEventType(byType)
                .countsBySeverity(bySeverity)
                .from(start)
                .to(end)
                .build();
    }

    private static void validateRange(Instant from, Instant to) {
        if (from != null && to != null && from.isAfter(to)) {
            throw new BankingException(ErrorCode.BAD_REQUEST, "'from' must not be after 'to'");
        }
    }
}

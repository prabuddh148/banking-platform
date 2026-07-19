package com.banking.audit.service;

import com.banking.audit.dto.response.AuditLogResponse;
import com.banking.audit.entity.AuditEventType;
import com.banking.audit.entity.AuditLog;
import com.banking.audit.entity.AuditSeverity;
import com.banking.audit.mapper.AuditLogMapper;
import com.banking.audit.repository.AuditLogRepository;
import com.banking.common.dto.PagedResponse;
import com.banking.common.exception.ResourceNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
@Slf4j
@RequiredArgsConstructor
@Transactional
public class AuditServiceImpl implements AuditService {

    private final AuditLogRepository auditLogRepository;
    private final AuditLogMapper auditLogMapper;

    @Override
    public AuditLogResponse recordEvent(AuditLog auditLog) {
        if (auditLog.getOccurredAt() == null) {
            auditLog.setOccurredAt(Instant.now());
        }

        AuditLog saved = auditLogRepository.save(auditLog);

        switch (saved.getSeverity()) {
            case CRITICAL -> log.error("AUDIT [CRITICAL] eventType={} resourceType={} resourceId={} description={}",
                    saved.getEventType(), saved.getResourceType(), saved.getResourceId(), saved.getDescription());
            case HIGH -> log.warn("AUDIT [HIGH] eventType={} resourceType={} resourceId={} description={}",
                    saved.getEventType(), saved.getResourceType(), saved.getResourceId(), saved.getDescription());
            case WARNING -> log.warn("AUDIT [WARNING] eventType={} resourceType={} resourceId={} description={}",
                    saved.getEventType(), saved.getResourceType(), saved.getResourceId(), saved.getDescription());
            default -> log.info("AUDIT [INFO] eventType={} resourceType={} resourceId={} description={}",
                    saved.getEventType(), saved.getResourceType(), saved.getResourceId(), saved.getDescription());
        }

        return auditLogMapper.toResponse(saved);
    }

    @Override
    @Transactional(readOnly = true)
    public AuditLogResponse getAuditLog(UUID id) {
        AuditLog auditLog = auditLogRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("AuditLog", id.toString()));
        return auditLogMapper.toResponse(auditLog);
    }

    @Override
    @Transactional(readOnly = true)
    public PagedResponse<AuditLogResponse> getAuditLogsByResource(UUID resourceId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        Page<AuditLog> auditLogs = auditLogRepository.findByResourceIdOrderByRecordedAtDesc(resourceId, pageable);
        return toPagedResponse(auditLogs);
    }

    @Override
    @Transactional(readOnly = true)
    public PagedResponse<AuditLogResponse> getAuditLogsByActor(UUID actorId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        Page<AuditLog> auditLogs = auditLogRepository.findByActorIdOrderByRecordedAtDesc(actorId, pageable);
        return toPagedResponse(auditLogs);
    }

    @Override
    @Transactional(readOnly = true)
    public PagedResponse<AuditLogResponse> getAuditLogsByService(String service, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        Page<AuditLog> auditLogs = auditLogRepository.findBySourceServiceOrderByRecordedAtDesc(service, pageable);
        return toPagedResponse(auditLogs);
    }

    @Override
    @Transactional(readOnly = true)
    public PagedResponse<AuditLogResponse> getAuditLogsByEventType(AuditEventType eventType, Instant from, Instant to, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        Page<AuditLog> auditLogs = auditLogRepository.findByEventTypeAndOccurredAtBetween(eventType, from, to, pageable);
        return toPagedResponse(auditLogs);
    }

    @Override
    @Transactional(readOnly = true)
    public PagedResponse<AuditLogResponse> getAuditLogsBySeverity(AuditSeverity severity, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        Page<AuditLog> auditLogs = auditLogRepository.findBySeverityOrderByRecordedAtDesc(severity, pageable);
        return toPagedResponse(auditLogs);
    }

    private PagedResponse<AuditLogResponse> toPagedResponse(Page<AuditLog> page) {
        List<AuditLogResponse> content = page.getContent().stream()
                .map(auditLogMapper::toResponse)
                .toList();
        return PagedResponse.<AuditLogResponse>builder()
                .content(content)
                .page(page.getNumber())
                .size(page.getSize())
                .totalElements(page.getTotalElements())
                .totalPages(page.getTotalPages())
                .last(page.isLast())
                .build();
    }
}

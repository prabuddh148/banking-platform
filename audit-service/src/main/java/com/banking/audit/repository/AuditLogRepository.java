package com.banking.audit.repository;

import com.banking.audit.entity.AuditEventType;
import com.banking.audit.entity.AuditLog;
import com.banking.audit.entity.AuditSeverity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.UUID;

@Repository
public interface AuditLogRepository extends JpaRepository<AuditLog, UUID> {

    Page<AuditLog> findByResourceIdOrderByRecordedAtDesc(UUID resourceId, Pageable pageable);

    Page<AuditLog> findByActorIdOrderByRecordedAtDesc(UUID actorId, Pageable pageable);

    Page<AuditLog> findByEventTypeAndOccurredAtBetween(AuditEventType eventType, Instant from, Instant to, Pageable pageable);

    Page<AuditLog> findBySourceServiceOrderByRecordedAtDesc(String sourceService, Pageable pageable);

    Page<AuditLog> findBySeverityOrderByRecordedAtDesc(AuditSeverity severity, Pageable pageable);

    long countByEventTypeAndOccurredAtAfter(AuditEventType eventType, Instant after);
}

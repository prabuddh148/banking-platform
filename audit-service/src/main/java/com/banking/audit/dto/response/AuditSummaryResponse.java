package com.banking.audit.dto.response;

import com.banking.audit.entity.AuditEventType;
import com.banking.audit.entity.AuditSeverity;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.Map;

/**
 * Counts of audit events in a time window, for the admin dashboard.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AuditSummaryResponse {
    private long totalEvents;
    private Map<AuditEventType, Long> countsByEventType;
    private Map<AuditSeverity, Long> countsBySeverity;
    private Instant from;
    private Instant to;
}

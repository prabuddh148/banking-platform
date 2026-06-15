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
public class AuditSummaryResponse {

    private UUID resourceId;
    private long totalEvents;
    private AuditEventType lastEventType;
    private Instant lastOccurredAt;
    private AuditSeverity severity;
}

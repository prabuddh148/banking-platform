package com.banking.audit.controller;

import com.banking.audit.dto.response.AuditLogResponse;
import com.banking.audit.entity.AuditEventType;
import com.banking.audit.entity.AuditSeverity;
import com.banking.audit.service.AuditService;
import com.banking.common.dto.ApiResponse;
import com.banking.common.dto.PagedResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/audit")
@Slf4j
@RequiredArgsConstructor
public class AuditController {

    private final AuditService auditService;

    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN', 'COMPLIANCE')")
    public ResponseEntity<ApiResponse<AuditLogResponse>> getAuditLog(@PathVariable UUID id) {
        log.debug("Getting audit log: {}", id);
        AuditLogResponse response = auditService.getAuditLog(id);
        return ResponseEntity.ok(ApiResponse.success(response));
    }

    @GetMapping("/resource/{resourceId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'COMPLIANCE')")
    public ResponseEntity<ApiResponse<PagedResponse<AuditLogResponse>>> getAuditLogsByResource(
            @PathVariable UUID resourceId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        log.debug("Getting audit logs for resource: {}", resourceId);
        PagedResponse<AuditLogResponse> response = auditService.getAuditLogsByResource(resourceId, page, size);
        return ResponseEntity.ok(ApiResponse.success(response));
    }

    @GetMapping("/actor/{actorId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'COMPLIANCE')")
    public ResponseEntity<ApiResponse<PagedResponse<AuditLogResponse>>> getAuditLogsByActor(
            @PathVariable UUID actorId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        log.debug("Getting audit logs for actor: {}", actorId);
        PagedResponse<AuditLogResponse> response = auditService.getAuditLogsByActor(actorId, page, size);
        return ResponseEntity.ok(ApiResponse.success(response));
    }

    @GetMapping("/service/{serviceName}")
    @PreAuthorize("hasAnyRole('ADMIN', 'COMPLIANCE')")
    public ResponseEntity<ApiResponse<PagedResponse<AuditLogResponse>>> getAuditLogsByService(
            @PathVariable String serviceName,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        log.debug("Getting audit logs for service: {}", serviceName);
        PagedResponse<AuditLogResponse> response = auditService.getAuditLogsByService(serviceName, page, size);
        return ResponseEntity.ok(ApiResponse.success(response));
    }

    @GetMapping("/event-type/{eventType}")
    @PreAuthorize("hasAnyRole('ADMIN', 'COMPLIANCE')")
    public ResponseEntity<ApiResponse<PagedResponse<AuditLogResponse>>> getAuditLogsByEventType(
            @PathVariable AuditEventType eventType,
            @RequestParam String from,
            @RequestParam String to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        log.debug("Getting audit logs for event type: {} from {} to {}", eventType, from, to);
        Instant fromInstant = Instant.parse(from);
        Instant toInstant = Instant.parse(to);
        PagedResponse<AuditLogResponse> response = auditService.getAuditLogsByEventType(eventType, fromInstant, toInstant, page, size);
        return ResponseEntity.ok(ApiResponse.success(response));
    }

    @GetMapping("/severity/{severity}")
    @PreAuthorize("hasAnyRole('ADMIN', 'COMPLIANCE')")
    public ResponseEntity<ApiResponse<PagedResponse<AuditLogResponse>>> getAuditLogsBySeverity(
            @PathVariable AuditSeverity severity,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        log.debug("Getting audit logs for severity: {}", severity);
        PagedResponse<AuditLogResponse> response = auditService.getAuditLogsBySeverity(severity, page, size);
        return ResponseEntity.ok(ApiResponse.success(response));
    }
}

package com.banking.audit.controller;

import com.banking.audit.dto.response.AuditLogResponse;
import com.banking.audit.dto.response.AuditSummaryResponse;
import com.banking.audit.entity.AuditEventType;
import com.banking.audit.entity.AuditSeverity;
import com.banking.audit.service.AuditService;
import com.banking.common.dto.ApiResponse;
import com.banking.common.dto.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.UUID;

/**
 * Read-only REST API over the audit logs. Every endpoint is admin-only
 * (class-level {@code @PreAuthorize}); customers get 403.
 * <p>
 * Lists are paged ({@code page} 0-based, {@code size} default 20, max 100). The general search and the
 * actor view show newest first; the aggregate and correlation views are timelines, so oldest first.
 */
@RestController
@RequestMapping("/api/v1/audit")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class AuditController {

    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 100;
    private static final String SORT_FIELD = "occurredAt";

    private final AuditService auditService;

    @GetMapping("/logs")
    public ApiResponse<PagedResponse<AuditLogResponse>> getLogs(
            @RequestParam(required = false) AuditEventType eventType,
            @RequestParam(required = false) String aggregateId,
            @RequestParam(required = false) String actor,
            @RequestParam(required = false) AuditSeverity severity,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "" + DEFAULT_PAGE_SIZE) int size) {
        return ApiResponse.success(auditService.getAuditLogs(eventType, aggregateId, actor, severity, from, to,
                pageable(page, size, Sort.Direction.DESC)));
    }

    @GetMapping("/logs/{id}")
    public ApiResponse<AuditLogResponse> getLog(@PathVariable UUID id) {
        return ApiResponse.success(auditService.getAuditLog(id));
    }

    @GetMapping("/logs/aggregate/{aggregateId}")
    public ApiResponse<PagedResponse<AuditLogResponse>> getLogsByAggregate(
            @PathVariable String aggregateId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "" + DEFAULT_PAGE_SIZE) int size) {
        return ApiResponse.success(auditService.getAuditLogsByAggregate(aggregateId,
                pageable(page, size, Sort.Direction.ASC)));
    }

    @GetMapping("/logs/actor/{actor}")
    public ApiResponse<PagedResponse<AuditLogResponse>> getLogsByActor(
            @PathVariable String actor,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "" + DEFAULT_PAGE_SIZE) int size) {
        return ApiResponse.success(auditService.getAuditLogsByActor(actor,
                pageable(page, size, Sort.Direction.DESC)));
    }

    @GetMapping("/logs/correlation/{correlationId}")
    public ApiResponse<PagedResponse<AuditLogResponse>> getLogsByCorrelation(
            @PathVariable String correlationId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "" + DEFAULT_PAGE_SIZE) int size) {
        return ApiResponse.success(auditService.getAuditLogsByCorrelation(correlationId,
                pageable(page, size, Sort.Direction.ASC)));
    }

    @GetMapping("/summary")
    public ApiResponse<AuditSummaryResponse> getSummary(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to) {
        return ApiResponse.success(auditService.getSummary(from, to));
    }

    /** Clamps page/size to sane values and sorts by occurredAt. */
    private static Pageable pageable(int page, int size, Sort.Direction direction) {
        int safePage = Math.max(page, 0);
        int safeSize = size < 1 ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);
        return PageRequest.of(safePage, safeSize, Sort.by(direction, SORT_FIELD));
    }
}

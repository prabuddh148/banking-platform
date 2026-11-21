package com.banking.audit;

import com.banking.audit.config.SecurityConfig;
import com.banking.audit.controller.AuditController;
import com.banking.audit.dto.response.AuditLogResponse;
import com.banking.audit.dto.response.AuditSummaryResponse;
import com.banking.audit.entity.AuditEventType;
import com.banking.audit.entity.AuditSeverity;
import com.banking.audit.security.JwtTokenValidator;
import com.banking.audit.service.AuditService;
import com.banking.common.dto.PagedResponse;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.JwtUtil;
import com.banking.common.security.SecurityConstants;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.data.domain.Pageable;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Web-layer tests for {@link AuditController}: real security (JWT filter + SecurityConfig + method security),
 * mocked service. Tokens are signed with the same default dev secret the service uses.
 */
@WebMvcTest(AuditController.class)
@Import({SecurityConfig.class, JwtTokenValidator.class})
class AuditControllerTest {

    private static final JwtUtil JWT = new JwtUtil("change-me-dev-secret-key-at-least-32-bytes-long",
            Duration.ofHours(1));

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private AuditService auditService;

    @Test
    void admin_canSearchLogs() throws Exception {
        when(auditService.getAuditLogs(eq(AuditEventType.FRAUD_DETECTED), isNull(), isNull(),
                eq(AuditSeverity.CRITICAL), eq(Instant.parse("2024-05-01T00:00:00Z")), isNull(), any(Pageable.class)))
                .thenReturn(new PagedResponse<>(List.of(sampleLog()), 0, 20, 1));

        mockMvc.perform(get("/api/v1/audit/logs")
                        .param("eventType", "FRAUD_DETECTED")
                        .param("severity", "CRITICAL")
                        .param("from", "2024-05-01T00:00:00Z")
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(admin())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.content[0].eventType").value("FRAUD_DETECTED"))
                .andExpect(jsonPath("$.data.content[0].severity").value("CRITICAL"))
                .andExpect(jsonPath("$.data.content[0].details.riskScore").value(90));
    }

    @Test
    void customer_isForbidden() throws Exception {
        mockMvc.perform(get("/api/v1/audit/logs")
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(customer())))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));

        mockMvc.perform(get("/api/v1/audit/summary")
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(customer())))
                .andExpect(status().isForbidden());

        verifyNoInteractions(auditService);
    }

    @Test
    void missingToken_isUnauthorized() throws Exception {
        mockMvc.perform(get("/api/v1/audit/logs"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
    }

    @Test
    void invalidToken_isUnauthorized() throws Exception {
        mockMvc.perform(get("/api/v1/audit/logs")
                        .header(SecurityConstants.AUTHORIZATION_HEADER, "Bearer not-a-real-token"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("INVALID_TOKEN"));
    }

    @Test
    void admin_canGetLogsByActor() throws Exception {
        when(auditService.getAuditLogsByActor(eq("CUST-1001"), any(Pageable.class)))
                .thenReturn(new PagedResponse<>(List.of(sampleLog()), 0, 20, 1));

        mockMvc.perform(get("/api/v1/audit/logs/actor/CUST-1001")
                        .param("size", "500")
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(admin())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.content[0].actor").value("CUST-1001"));

        // size is capped at 100
        verify(auditService).getAuditLogsByActor(eq("CUST-1001"),
                argThat(p -> p.getPageSize() == 100));
    }

    @Test
    void admin_getUnknownLog_isNotFound() throws Exception {
        UUID id = UUID.randomUUID();
        when(auditService.getAuditLog(id)).thenThrow(new BankingException(ErrorCode.AUDIT_LOG_NOT_FOUND));

        mockMvc.perform(get("/api/v1/audit/logs/{id}", id)
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(admin())))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("AUDIT_LOG_NOT_FOUND"));
    }

    @Test
    void admin_invalidEventTypeFilter_isBadRequest() throws Exception {
        mockMvc.perform(get("/api/v1/audit/logs")
                        .param("eventType", "NOT_A_TYPE")
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(admin())))
                .andExpect(status().isBadRequest());
    }

    @Test
    void admin_canGetSummary() throws Exception {
        Instant from = Instant.parse("2024-05-01T00:00:00Z");
        Instant to = Instant.parse("2024-05-31T00:00:00Z");
        when(auditService.getSummary(from, to)).thenReturn(AuditSummaryResponse.builder()
                .totalEvents(3)
                .countsByEventType(Map.of(AuditEventType.TRANSACTION_COMPLETED, 3L))
                .countsBySeverity(Map.of(AuditSeverity.INFO, 3L))
                .from(from)
                .to(to)
                .build());

        mockMvc.perform(get("/api/v1/audit/summary")
                        .param("from", "2024-05-01T00:00:00Z")
                        .param("to", "2024-05-31T00:00:00Z")
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(admin())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalEvents").value(3))
                .andExpect(jsonPath("$.data.countsByEventType.TRANSACTION_COMPLETED").value(3))
                .andExpect(jsonPath("$.data.countsBySeverity.INFO").value(3));
    }

    // ---------------------------------------------------------------- helpers

    private static AuthenticatedUser admin() {
        return new AuthenticatedUser("ADMIN-1", "admin", "admin@meridian.bank", "Devon Ellis",
                List.of(SecurityConstants.ROLE_ADMIN, SecurityConstants.ROLE_CUSTOMER));
    }

    private static AuthenticatedUser customer() {
        return new AuthenticatedUser("CUST-1001", "rahul", "rahul.sharma@example.com", "Rahul Sharma",
                List.of(SecurityConstants.ROLE_CUSTOMER));
    }

    private static String bearer(AuthenticatedUser user) {
        return SecurityConstants.BEARER_PREFIX + JWT.generateToken(user);
    }

    private static AuditLogResponse sampleLog() throws Exception {
        return AuditLogResponse.builder()
                .id(UUID.randomUUID())
                .eventId("evt-1")
                .eventType(AuditEventType.FRAUD_DETECTED)
                .aggregateId("t-1")
                .aggregateType("FRAUD")
                .actor("CUST-1001")
                .action("Fraud check flagged transaction t-1: decision BLOCK, risk CRITICAL (90/100)")
                .severity(AuditSeverity.CRITICAL)
                .sourceService("fraud-service")
                .correlationId("corr-1")
                .details(new ObjectMapper().readTree("{\"riskScore\":90}"))
                .occurredAt(Instant.parse("2024-05-01T10:00:00Z"))
                .recordedAt(Instant.parse("2024-05-01T10:00:01Z"))
                .build();
    }
}

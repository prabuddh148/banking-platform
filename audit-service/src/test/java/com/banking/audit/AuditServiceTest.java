package com.banking.audit;

import com.banking.audit.dto.response.AuditLogResponse;
import com.banking.audit.dto.response.AuditSummaryResponse;
import com.banking.audit.entity.AuditEventType;
import com.banking.audit.entity.AuditLog;
import com.banking.audit.entity.AuditSeverity;
import com.banking.audit.mapper.AuditLogMapper;
import com.banking.audit.repository.AuditLogRepository;
import com.banking.audit.service.AuditServiceImpl;
import com.banking.audit.util.AuditLogFormatter;
import com.banking.common.dto.PagedResponse;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mapstruct.factory.Mappers;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link AuditServiceImpl}: only the repository is mocked; the real formatter and the
 * MapStruct-generated mapper are used. No Kafka or database needed.
 */
@ExtendWith(MockitoExtension.class)
class AuditServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Mock
    private AuditLogRepository auditLogRepository;

    private AuditServiceImpl auditService;

    @BeforeEach
    void setUp() {
        AuditLogMapper mapper = Mappers.getMapper(AuditLogMapper.class);
        auditService = new AuditServiceImpl(auditLogRepository, mapper, new AuditLogFormatter(objectMapper));
    }

    // ---------------------------------------------------------------- recording

    @Test
    void recordEvent_accountCreated_storesMaskedAuditLog() throws Exception {
        when(auditLogRepository.existsByEventId("evt-1")).thenReturn(false);

        boolean recorded = auditService.recordEvent(event("evt-1", "ACCOUNT_CREATED", """
                {"accountId":"acc-1","accountNumber":"ACC1234567890","customerId":"CUST-1001",
                 "customerName":"Rahul Sharma","customerEmail":"rahul.sharma@example.com",
                 "customerPhone":"+919876543210","accountType":"SAVINGS","currency":"INR","initialBalance":1000.00}
                """));

        assertThat(recorded).isTrue();
        AuditLog saved = capturedLog();
        assertThat(saved.getEventId()).isEqualTo("evt-1");
        assertThat(saved.getEventType()).isEqualTo(AuditEventType.ACCOUNT_CREATED);
        assertThat(saved.getAggregateType()).isEqualTo("ACCOUNT");
        assertThat(saved.getAggregateId()).isEqualTo("agg-1");
        assertThat(saved.getActor()).isEqualTo("CUST-1001");
        assertThat(saved.getSeverity()).isEqualTo(AuditSeverity.INFO);
        assertThat(saved.getSourceService()).isEqualTo("account-service");
        assertThat(saved.getCorrelationId()).isEqualTo("corr-1");
        assertThat(saved.getOccurredAt()).isEqualTo(Instant.parse("2024-05-01T10:15:30Z"));
        assertThat(saved.getAction()).contains("*********7890").contains("SAVINGS").doesNotContain("ACC1234567890");

        // Masking: PII never reaches the details column in clear text.
        JsonNode details = objectMapper.readTree(saved.getDetails());
        assertThat(details.get("customerEmail").asText()).isEqualTo("r***********@example.com");
        assertThat(details.get("customerPhone").asText()).isEqualTo("*********3210");
        assertThat(details.get("accountNumber").asText()).isEqualTo("*********7890");
        assertThat(details.get("customerName").asText()).isEqualTo("Rahul Sharma");
        assertThat(saved.getDetails())
                .doesNotContain("rahul.sharma@example.com", "+919876543210", "ACC1234567890");
        // Envelope fields have their own columns and are not repeated in details.
        assertThat(details.has("eventId")).isFalse();
        assertThat(details.has("correlationId")).isFalse();
    }

    @Test
    void recordEvent_masksNestedAndRecipientFields() throws Exception {
        auditService.recordEvent(event("evt-n", "NOTIFICATION_REQUESTED", """
                {"recipientId":"CUST-1002","recipientEmail":"priya.patel@example.com","recipientPhone":"9123456789",
                 "channel":"EMAIL","notificationType":"WELCOME","meta":{"contactEmail":"x.y@example.com"}}
                """));

        AuditLog saved = capturedLog();
        JsonNode details = objectMapper.readTree(saved.getDetails());
        assertThat(details.get("recipientEmail").asText()).isEqualTo("p**********@example.com");
        assertThat(details.get("recipientPhone").asText()).isEqualTo("******6789");
        assertThat(details.at("/meta/contactEmail").asText()).isEqualTo("x**@example.com");
        assertThat(saved.getAggregateType()).isEqualTo("NOTIFICATION");
        assertThat(saved.getActor()).isEqualTo("system");
    }

    @ParameterizedTest(name = "{0} / decision {1} -> {2}")
    @CsvSource({
            "FRAUD_DETECTED, BLOCK, CRITICAL",
            "FRAUD_DETECTED, REVIEW, WARNING",
            "FRAUD_CLEARED, APPROVE, INFO",
            "TRANSACTION_FAILED, , WARNING",
            "BALANCE_UPDATE_FAILED, , WARNING",
            "ACCOUNT_STATUS_CHANGED, , WARNING",
            "TRANSACTION_INITIATED, , INFO",
            "TRANSACTION_COMPLETED, , INFO",
            "BALANCE_UPDATED, , INFO",
            "BALANCE_UPDATE_REQUESTED, , INFO",
            "ACCOUNT_CREATED, , INFO"
    })
    void recordEvent_mapsSeverity(String eventType, String decision, AuditSeverity expected) throws Exception {
        String payload = decision == null ? "{}" : "{\"decision\":\"" + decision + "\"}";

        auditService.recordEvent(event("evt-" + eventType, eventType, payload));

        assertThat(capturedLog().getSeverity()).isEqualTo(expected);
    }

    @ParameterizedTest(name = "{0} -> actor {2}")
    @CsvSource({
            "TRANSACTION_INITIATED, '{\"initiatedBy\":\"CUST-1001\",\"transactionType\":\"TRANSFER\"}', CUST-1001",
            "ACCOUNT_STATUS_CHANGED, '{\"changedBy\":\"ADMIN-1\",\"customerId\":\"CUST-1002\"}', ADMIN-1",
            "FRAUD_CLEARED, '{\"reviewedBy\":\"ADMIN-1\",\"decision\":\"APPROVE\"}', ADMIN-1",
            "FRAUD_DETECTED, '{\"reviewedBy\":null,\"decision\":\"REVIEW\"}', system",
            "BALANCE_UPDATED, '{\"transactionId\":\"t-1\"}', system"
    })
    void recordEvent_resolvesActor(String eventType, String payload, String expectedActor) throws Exception {
        auditService.recordEvent(event("evt-" + eventType, eventType, payload));

        assertThat(capturedLog().getActor()).isEqualTo(expectedActor);
    }

    @Test
    void recordEvent_buildsReadableActionText() throws Exception {
        auditService.recordEvent(event("evt-tf", "TRANSACTION_FAILED", """
                {"transactionId":"t-1","reference":"TXN20240501ABCD1234","transactionType":"TRANSFER",
                 "amount":500.00,"currency":"INR","initiatedBy":"CUST-1001",
                 "failureReason":"Insufficient funds","failureCode":"INSUFFICIENT_FUNDS"}
                """));

        AuditLog saved = capturedLog();
        assertThat(saved.getAction())
                .isEqualTo("TRANSFER TXN20240501ABCD1234 of 500.00 INR failed: Insufficient funds (INSUFFICIENT_FUNDS)");
        assertThat(saved.getAggregateType()).isEqualTo("TRANSACTION");
    }

    @Test
    void recordEvent_duplicateEventId_isSkipped() throws Exception {
        when(auditLogRepository.existsByEventId("evt-dup")).thenReturn(true);

        boolean recorded = auditService.recordEvent(event("evt-dup", "TRANSACTION_COMPLETED", "{}"));

        assertThat(recorded).isFalse();
        verify(auditLogRepository, never()).save(any());
    }

    @Test
    void recordEvent_unknownEventType_isStillRecorded() throws Exception {
        auditService.recordEvent(event("evt-u", "SOMETHING_NEW", "{}"));

        AuditLog saved = capturedLog();
        assertThat(saved.getEventType()).isEqualTo(AuditEventType.UNKNOWN);
        assertThat(saved.getRawEventType()).isEqualTo("SOMETHING_NEW");
        assertThat(saved.getAggregateType()).isEqualTo("UNKNOWN");
        assertThat(saved.getSeverity()).isEqualTo(AuditSeverity.INFO);
    }

    @Test
    void recordEvent_withoutEventId_isRejected() throws Exception {
        JsonNode noId = objectMapper.readTree("{\"eventType\":\"ACCOUNT_CREATED\"}");

        assertThatThrownBy(() -> auditService.recordEvent(noId)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> auditService.recordEvent(objectMapper.readTree("[1,2]")))
                .isInstanceOf(IllegalArgumentException.class);
        verify(auditLogRepository, never()).save(any());
    }

    // ---------------------------------------------------------------- queries

    @Test
    void getSummary_fillsMissingCountsWithZero() {
        Instant from = Instant.parse("2024-05-01T00:00:00Z");
        Instant to = Instant.parse("2024-05-31T00:00:00Z");
        when(auditLogRepository.countInRange(from, to)).thenReturn(5L);
        when(auditLogRepository.countByEventType(from, to)).thenReturn(List.of(
                new Object[]{AuditEventType.TRANSACTION_COMPLETED, 3L},
                new Object[]{AuditEventType.FRAUD_DETECTED, 2L}));
        when(auditLogRepository.countBySeverity(from, to)).thenReturn(List.of(
                new Object[]{AuditSeverity.INFO, 3L},
                new Object[]{AuditSeverity.CRITICAL, 2L}));

        AuditSummaryResponse summary = auditService.getSummary(from, to);

        assertThat(summary.getTotalEvents()).isEqualTo(5);
        assertThat(summary.getCountsByEventType())
                .hasSize(AuditEventType.values().length)
                .containsEntry(AuditEventType.TRANSACTION_COMPLETED, 3L)
                .containsEntry(AuditEventType.FRAUD_DETECTED, 2L)
                .containsEntry(AuditEventType.ACCOUNT_CREATED, 0L);
        assertThat(summary.getCountsBySeverity())
                .containsEntry(AuditSeverity.INFO, 3L)
                .containsEntry(AuditSeverity.WARNING, 0L)
                .containsEntry(AuditSeverity.CRITICAL, 2L);
        assertThat(summary.getFrom()).isEqualTo(from);
        assertThat(summary.getTo()).isEqualTo(to);
    }

    @Test
    void getSummary_fromAfterTo_isBadRequest() {
        Instant now = Instant.now();

        assertThatThrownBy(() -> auditService.getSummary(now, now.minusSeconds(60)))
                .isInstanceOfSatisfying(BankingException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(ErrorCode.BAD_REQUEST));
    }

    @Test
    void getAuditLog_notFound_throwsAuditLogNotFound() {
        UUID id = UUID.randomUUID();
        when(auditLogRepository.findById(id)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> auditService.getAuditLog(id))
                .isInstanceOfSatisfying(BankingException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(ErrorCode.AUDIT_LOG_NOT_FOUND));
    }

    @Test
    void getAuditLogsByActor_mapsEntitiesToResponses() {
        Pageable pageable = PageRequest.of(0, 20);
        AuditLog log = AuditLog.builder()
                .id(UUID.randomUUID())
                .eventId("evt-9")
                .eventType(AuditEventType.TRANSACTION_COMPLETED)
                .aggregateId("t-9")
                .aggregateType("TRANSACTION")
                .actor("CUST-1001")
                .action("DEPOSIT TXN1 of 10 INR completed")
                .severity(AuditSeverity.INFO)
                .details("{\"amount\":10}")
                .occurredAt(Instant.parse("2024-05-01T10:00:00Z"))
                .recordedAt(Instant.parse("2024-05-01T10:00:01Z"))
                .build();
        when(auditLogRepository.findByActor(anyString(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(log), pageable, 1));

        PagedResponse<AuditLogResponse> page = auditService.getAuditLogsByActor("CUST-1001", pageable);

        assertThat(page.getTotalElements()).isEqualTo(1);
        AuditLogResponse response = page.getContent().get(0);
        assertThat(response.getEventId()).isEqualTo("evt-9");
        assertThat(response.getActor()).isEqualTo("CUST-1001");
        assertThat(response.getDetails().get("amount").asInt()).isEqualTo(10);
    }

    // ---------------------------------------------------------------- helpers

    /** Builds an event: BaseEvent envelope fields + the given payload fields. */
    private JsonNode event(String eventId, String eventType, String payloadJson) throws Exception {
        ObjectNode node = (ObjectNode) objectMapper.readTree(payloadJson);
        node.put("eventId", eventId);
        node.put("eventType", eventType);
        node.put("aggregateId", "agg-1");
        node.put("occurredAt", "2024-05-01T10:15:30Z");
        node.put("correlationId", "corr-1");
        node.put("source", "account-service");
        node.put("schemaVersion", 1);
        return node;
    }

    private AuditLog capturedLog() {
        ArgumentCaptor<AuditLog> captor = ArgumentCaptor.forClass(AuditLog.class);
        verify(auditLogRepository).save(captor.capture());
        return captor.getValue();
    }
}

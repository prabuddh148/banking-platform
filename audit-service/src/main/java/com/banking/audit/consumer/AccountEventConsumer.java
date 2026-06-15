package com.banking.audit.consumer;

import com.banking.audit.entity.AuditEventType;
import com.banking.audit.entity.AuditLog;
import com.banking.audit.entity.AuditSeverity;
import com.banking.audit.service.AuditService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Service
@Slf4j
@RequiredArgsConstructor
public class AccountEventConsumer {

    private final AuditService auditService;

    @KafkaListener(topics = {"account.created", "account.status.changed"},
            groupId = "${spring.kafka.consumer.group-id}")
    public void consume(ConsumerRecord<String, Map<String, Object>> record,
                        @Header(KafkaHeaders.RECEIVED_TOPIC) String topic) {
        log.info("Received account event on topic: {}", topic);
        try {
            Map<String, Object> payload = record.value();
            AuditLog auditLog;

            if ("account.created".equals(topic)) {
                auditLog = handleAccountCreated(payload);
            } else if ("account.status.changed".equals(topic)) {
                auditLog = handleAccountStatusChanged(payload);
            } else {
                log.warn("Unhandled account topic: {}", topic);
                return;
            }

            auditService.recordEvent(auditLog);
        } catch (Exception e) {
            log.error("Error processing account event from topic {}: {}", topic, e.getMessage(), e);
        }
    }

    private AuditLog handleAccountCreated(Map<String, Object> payload) {
        String accountIdStr = String.valueOf(payload.getOrDefault("accountId", ""));
        String customerIdStr = String.valueOf(payload.getOrDefault("customerId", ""));
        String correlationId = String.valueOf(payload.getOrDefault("correlationId", ""));

        UUID accountId = parseUUID(accountIdStr);
        UUID customerId = parseUUID(customerIdStr);

        return AuditLog.builder()
                .eventType(AuditEventType.ACCOUNT_CREATED)
                .severity(AuditSeverity.INFO)
                .actorId(customerId)
                .actorType("CUSTOMER")
                .resourceType("Account")
                .resourceId(accountId)
                .action("CREATE")
                .description("Account created for customer: " + customerIdStr)
                .sourceService("account-service")
                .correlationId(correlationId)
                .occurredAt(Instant.now())
                .build();
    }

    private AuditLog handleAccountStatusChanged(Map<String, Object> payload) {
        String accountIdStr = String.valueOf(payload.getOrDefault("accountId", ""));
        String previousStatus = String.valueOf(payload.getOrDefault("previousStatus", ""));
        String newStatus = String.valueOf(payload.getOrDefault("newStatus", ""));
        String correlationId = String.valueOf(payload.getOrDefault("correlationId", ""));

        UUID accountId = parseUUID(accountIdStr);

        return AuditLog.builder()
                .eventType(AuditEventType.ACCOUNT_STATUS_CHANGED)
                .severity(AuditSeverity.WARNING)
                .actorType("SYSTEM")
                .resourceType("Account")
                .resourceId(accountId)
                .action("STATUS_CHANGE")
                .description("Account status changed from " + previousStatus + " to " + newStatus)
                .oldValue("\"" + previousStatus + "\"")
                .newValue("\"" + newStatus + "\"")
                .sourceService("account-service")
                .correlationId(correlationId)
                .occurredAt(Instant.now())
                .build();
    }

    private UUID parseUUID(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}

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
public class TransactionEventConsumer {

    private final AuditService auditService;

    @KafkaListener(topics = {"transaction.initiated", "transaction.completed", "transaction.failed"},
            groupId = "${spring.kafka.consumer.group-id}")
    public void consume(ConsumerRecord<String, Map<String, Object>> record,
                        @Header(KafkaHeaders.RECEIVED_TOPIC) String topic) {
        log.info("Received transaction event on topic: {}", topic);
        try {
            Map<String, Object> payload = record.value();
            AuditLog auditLog = buildTransactionAuditLog(topic, payload);
            if (auditLog != null) {
                auditService.recordEvent(auditLog);
            }
        } catch (Exception e) {
            log.error("Error processing transaction event from topic {}: {}", topic, e.getMessage(), e);
        }
    }

    private AuditLog buildTransactionAuditLog(String topic, Map<String, Object> payload) {
        String transactionIdStr = String.valueOf(payload.getOrDefault("transactionId", ""));
        String referenceNumber = String.valueOf(payload.getOrDefault("referenceNumber", ""));
        String amount = String.valueOf(payload.getOrDefault("amount", ""));
        String sourceAccountIdStr = String.valueOf(payload.getOrDefault("sourceAccountId", ""));
        String correlationId = String.valueOf(payload.getOrDefault("correlationId", ""));

        UUID transactionId = parseUUID(transactionIdStr);

        return switch (topic) {
            case "transaction.initiated" -> AuditLog.builder()
                    .eventType(AuditEventType.TRANSACTION_INITIATED)
                    .severity(AuditSeverity.INFO)
                    .actorType("CUSTOMER")
                    .resourceType("Transaction")
                    .resourceId(transactionId)
                    .action("CREATE")
                    .description("Transaction initiated: ref=" + referenceNumber + ", amount=" + amount)
                    .metadata("{\"sourceAccountId\":\"" + sourceAccountIdStr
                            + "\",\"referenceNumber\":\"" + referenceNumber
                            + "\",\"amount\":\"" + amount + "\"}")
                    .sourceService("transaction-service")
                    .correlationId(correlationId)
                    .occurredAt(Instant.now())
                    .build();

            case "transaction.completed" -> AuditLog.builder()
                    .eventType(AuditEventType.TRANSACTION_COMPLETED)
                    .severity(AuditSeverity.INFO)
                    .actorType("SYSTEM")
                    .resourceType("Transaction")
                    .resourceId(transactionId)
                    .action("UPDATE")
                    .description("Transaction completed: ref=" + referenceNumber + ", amount=" + amount)
                    .metadata("{\"sourceAccountId\":\"" + sourceAccountIdStr
                            + "\",\"referenceNumber\":\"" + referenceNumber
                            + "\",\"amount\":\"" + amount + "\"}")
                    .sourceService("transaction-service")
                    .correlationId(correlationId)
                    .occurredAt(Instant.now())
                    .build();

            case "transaction.failed" -> AuditLog.builder()
                    .eventType(AuditEventType.TRANSACTION_FAILED)
                    .severity(AuditSeverity.HIGH)
                    .actorType("SYSTEM")
                    .resourceType("Transaction")
                    .resourceId(transactionId)
                    .action("UPDATE")
                    .description("Transaction failed: ref=" + referenceNumber + ", amount=" + amount)
                    .metadata("{\"sourceAccountId\":\"" + sourceAccountIdStr
                            + "\",\"referenceNumber\":\"" + referenceNumber
                            + "\",\"amount\":\"" + amount + "\"}")
                    .sourceService("transaction-service")
                    .correlationId(correlationId)
                    .occurredAt(Instant.now())
                    .build();

            default -> {
                log.warn("Unhandled transaction topic: {}", topic);
                yield null;
            }
        };
    }

    private UUID parseUUID(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}

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
public class FraudEventConsumer {

    private final AuditService auditService;

    @KafkaListener(topics = {"fraud.detected"}, groupId = "${spring.kafka.consumer.group-id}")
    public void consume(ConsumerRecord<String, Map<String, Object>> record,
                        @Header(KafkaHeaders.RECEIVED_TOPIC) String topic) {
        log.info("Received fraud event on topic: {}", topic);
        try {
            Map<String, Object> payload = record.value();

            String alertIdStr = String.valueOf(payload.getOrDefault("alertId", ""));
            String transactionIdStr = String.valueOf(payload.getOrDefault("transactionId", ""));
            String accountIdStr = String.valueOf(payload.getOrDefault("accountId", ""));
            String riskLevel = String.valueOf(payload.getOrDefault("riskLevel", ""));
            String decision = String.valueOf(payload.getOrDefault("decision", ""));
            String correlationId = String.valueOf(payload.getOrDefault("correlationId", ""));

            UUID alertId = parseUUID(alertIdStr);

            AuditLog auditLog = AuditLog.builder()
                    .eventType(AuditEventType.FRAUD_DETECTED)
                    .severity(AuditSeverity.CRITICAL)
                    .actorType("SYSTEM")
                    .resourceType("FraudAlert")
                    .resourceId(alertId)
                    .action("CREATE")
                    .description("Fraud detected: alertId=" + alertIdStr
                            + ", riskLevel=" + riskLevel
                            + ", decision=" + decision)
                    .metadata("{\"transactionId\":\"" + transactionIdStr
                            + "\",\"accountId\":\"" + accountIdStr
                            + "\",\"riskLevel\":\"" + riskLevel
                            + "\",\"decision\":\"" + decision + "\"}")
                    .sourceService("fraud-service")
                    .correlationId(correlationId)
                    .occurredAt(Instant.now())
                    .build();

            auditService.recordEvent(auditLog);
        } catch (Exception e) {
            log.error("Error processing fraud event: {}", e.getMessage(), e);
        }
    }

    private UUID parseUUID(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}

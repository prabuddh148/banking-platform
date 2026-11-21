package com.banking.audit.consumer;

import com.banking.audit.service.AuditService;
import com.banking.common.event.EventType;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Records every event on {@code banking.fraud.events} (FRAUD_CLEARED, FRAUD_DETECTED, and anything new).
 * Invalid JSON throws, and the Kafka error handler sends the message to the DLT.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FraudEventConsumer {

    private final AuditService auditService;
    private final ObjectMapper objectMapper;

    @KafkaListener(topics = EventType.Topics.FRAUD, groupId = "${spring.kafka.consumer.group-id:audit-service}")
    public void onFraudEvent(ConsumerRecord<String, String> record) throws JsonProcessingException {
        log.debug("Fraud event received: key={}, partition={}, offset={}",
                record.key(), record.partition(), record.offset());
        auditService.recordEvent(objectMapper.readTree(record.value()));
    }
}

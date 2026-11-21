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
 * Records every event on {@code banking.account.events}
 * (ACCOUNT_CREATED, ACCOUNT_STATUS_CHANGED, BALANCE_UPDATED, BALANCE_UPDATE_FAILED, and anything new).
 * Invalid JSON throws, and the Kafka error handler sends the message to the DLT.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AccountEventConsumer {

    private final AuditService auditService;
    private final ObjectMapper objectMapper;

    @KafkaListener(topics = EventType.Topics.ACCOUNT, groupId = "${spring.kafka.consumer.group-id:audit-service}")
    public void onAccountEvent(ConsumerRecord<String, String> record) throws JsonProcessingException {
        log.debug("Account event received: key={}, partition={}, offset={}",
                record.key(), record.partition(), record.offset());
        auditService.recordEvent(objectMapper.readTree(record.value()));
    }
}

package com.banking.fraud.consumer;

import com.banking.common.event.EventType;
import com.banking.fraud.event.TransactionInitiatedEvent;
import com.banking.fraud.service.FraudDetectionService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Listens on the transaction topic. Many event types travel there; we only care about
 * TRANSACTION_INITIATED and ignore the rest. Duplicate deliveries are harmless because the
 * service skips transactions that already have a decision.
 * Exceptions are handled by the DefaultErrorHandler (retries, then the .DLT topic).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TransactionInitiatedConsumer {

    private final ObjectMapper objectMapper;
    private final FraudDetectionService fraudDetectionService;

    @KafkaListener(topics = EventType.Topics.TRANSACTION, groupId = "${spring.kafka.consumer.group-id:fraud-service}")
    public void onMessage(ConsumerRecord<String, String> record) throws JsonProcessingException {
        JsonNode json = objectMapper.readTree(record.value());
        String eventType = json.path("eventType").asText(null);
        if (!EventType.TRANSACTION_INITIATED.name().equals(eventType)) {
            log.debug("Ignoring {} event (key={})", eventType, record.key());
            return;
        }
        TransactionInitiatedEvent event = objectMapper.treeToValue(json, TransactionInitiatedEvent.class);
        log.info("Received TRANSACTION_INITIATED for transaction {} (eventId={})",
                event.getTransactionId(), event.getEventId());
        fraudDetectionService.processTransactionInitiated(event);
    }
}

package com.banking.transaction.consumer;

import com.banking.common.event.EventType;
import com.banking.transaction.event.FraudDecisionReceivedEvent;
import com.banking.transaction.saga.TransactionSagaOrchestrator;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Listens to {@code banking.fraud.events} for fraud-service's verdict on a transaction
 * (FRAUD_CLEARED or FRAUD_DETECTED) and hands it to the saga orchestrator.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FraudDecisionConsumer {

    private final ObjectMapper objectMapper;
    private final TransactionSagaOrchestrator sagaOrchestrator;

    @KafkaListener(topics = EventType.Topics.FRAUD,
            groupId = "${spring.kafka.consumer.group-id:transaction-service}")
    public void onFraudEvent(ConsumerRecord<String, String> record) throws JsonProcessingException {
        if (record.value() == null) {
            log.warn("Ignoring record with empty value on {} (key={})", record.topic(), record.key());
            return;
        }
        JsonNode json = objectMapper.readTree(record.value());
        String eventType = json.path("eventType").asText("");
        switch (eventType) {
            case "FRAUD_CLEARED", "FRAUD_DETECTED" -> {
                FraudDecisionReceivedEvent event = objectMapper.treeToValue(json, FraudDecisionReceivedEvent.class);
                log.debug("Received {} ({}) for transaction {}", eventType, event.getDecision(), event.getTransactionId());
                sagaOrchestrator.handleFraudDecision(event);
            }
            default -> log.trace("Ignoring fraud event type '{}'", eventType);
        }
    }
}

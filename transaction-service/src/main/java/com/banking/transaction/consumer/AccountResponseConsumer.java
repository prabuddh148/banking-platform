package com.banking.transaction.consumer;

import com.banking.common.event.EventType;
import com.banking.transaction.event.BalanceUpdateFailedEvent;
import com.banking.transaction.event.BalanceUpdatedEvent;
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
 * Listens to {@code banking.account.events} for account-service's answer to our
 * BALANCE_UPDATE_REQUESTED: BALANCE_UPDATED or BALANCE_UPDATE_FAILED.
 * Other account events (ACCOUNT_CREATED, ...) are ignored. The orchestrator does the real work
 * (including skipping duplicates).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AccountResponseConsumer {

    private final ObjectMapper objectMapper;
    private final TransactionSagaOrchestrator sagaOrchestrator;

    @KafkaListener(topics = EventType.Topics.ACCOUNT,
            groupId = "${spring.kafka.consumer.group-id:transaction-service}")
    public void onAccountEvent(ConsumerRecord<String, String> record) throws JsonProcessingException {
        if (record.value() == null) {
            log.warn("Ignoring record with empty value on {} (key={})", record.topic(), record.key());
            return;
        }
        JsonNode json = objectMapper.readTree(record.value());
        String eventType = json.path("eventType").asText("");
        switch (eventType) {
            case "BALANCE_UPDATED" -> {
                BalanceUpdatedEvent event = objectMapper.treeToValue(json, BalanceUpdatedEvent.class);
                log.debug("Received BALANCE_UPDATED for transaction {}", event.getTransactionId());
                sagaOrchestrator.handleBalanceUpdated(event);
            }
            case "BALANCE_UPDATE_FAILED" -> {
                BalanceUpdateFailedEvent event = objectMapper.treeToValue(json, BalanceUpdateFailedEvent.class);
                log.debug("Received BALANCE_UPDATE_FAILED for transaction {}", event.getTransactionId());
                sagaOrchestrator.handleBalanceUpdateFailed(event);
            }
            default -> log.trace("Ignoring account event type '{}'", eventType);
        }
    }
}

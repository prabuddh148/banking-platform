package com.banking.notification.consumer;

import com.banking.common.event.EventType;
import com.banking.notification.event.TransactionCompletedEvent;
import com.banking.notification.event.TransactionFailedEvent;
import com.banking.notification.service.NotificationService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Listens to {@code banking.transaction.events}.
 * <ul>
 *     <li>TRANSACTION_COMPLETED -> EMAIL + SMS to the account holder (and to the receiver of a transfer)</li>
 *     <li>TRANSACTION_FAILED -> EMAIL + SMS to the account holder</li>
 * </ul>
 * Saga-internal events (TRANSACTION_INITIATED, BALANCE_UPDATE_REQUESTED) are ignored.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TransactionEventConsumer {

    private final ObjectMapper objectMapper;
    private final NotificationService notificationService;

    @KafkaListener(topics = EventType.Topics.TRANSACTION, groupId = "${spring.kafka.consumer.group-id:notification-service}")
    public void onMessage(ConsumerRecord<String, String> record) throws JsonProcessingException {
        JsonNode node = objectMapper.readTree(record.value());
        String eventType = node.path("eventType").asText("");
        log.debug("Received {} (key {}) from {}", eventType, record.key(), record.topic());

        switch (eventType) {
            case "TRANSACTION_COMPLETED" -> notificationService.handleTransactionCompleted(
                    objectMapper.treeToValue(node, TransactionCompletedEvent.class));
            case "TRANSACTION_FAILED" -> notificationService.handleTransactionFailed(
                    objectMapper.treeToValue(node, TransactionFailedEvent.class));
            default -> log.trace("Ignoring transaction event {}", eventType);
        }
    }
}

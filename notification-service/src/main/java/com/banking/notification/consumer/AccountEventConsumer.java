package com.banking.notification.consumer;

import com.banking.common.event.EventType;
import com.banking.notification.event.AccountCreatedEvent;
import com.banking.notification.event.AccountStatusChangedEvent;
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
 * Listens to {@code banking.account.events}.
 * <ul>
 *     <li>ACCOUNT_CREATED -> store the owner's contact details + welcome email</li>
 *     <li>ACCOUNT_STATUS_CHANGED -> email about freeze / unfreeze / close</li>
 * </ul>
 * Other account events (BALANCE_UPDATED ...) are ignored.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AccountEventConsumer {

    private final ObjectMapper objectMapper;
    private final NotificationService notificationService;

    @KafkaListener(topics = EventType.Topics.ACCOUNT, groupId = "${spring.kafka.consumer.group-id:notification-service}")
    public void onMessage(ConsumerRecord<String, String> record) throws JsonProcessingException {
        JsonNode node = objectMapper.readTree(record.value());
        String eventType = node.path("eventType").asText("");
        log.debug("Received {} (key {}) from {}", eventType, record.key(), record.topic());

        switch (eventType) {
            case "ACCOUNT_CREATED" ->
                    notificationService.handleAccountCreated(objectMapper.treeToValue(node, AccountCreatedEvent.class));
            case "ACCOUNT_STATUS_CHANGED" ->
                    notificationService.handleAccountStatusChanged(
                            objectMapper.treeToValue(node, AccountStatusChangedEvent.class));
            default -> log.trace("Ignoring account event {}", eventType);
        }
    }
}

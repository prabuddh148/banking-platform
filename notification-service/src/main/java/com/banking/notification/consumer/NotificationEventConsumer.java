package com.banking.notification.consumer;

import com.banking.common.event.EventType;
import com.banking.notification.event.NotificationRequestedEvent;
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
 * Listens to {@code banking.notification.events}: NOTIFICATION_REQUESTED lets any service ask
 * for a free-form email / SMS / push to a customer.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class NotificationEventConsumer {

    private final ObjectMapper objectMapper;
    private final NotificationService notificationService;

    @KafkaListener(topics = EventType.Topics.NOTIFICATION, groupId = "${spring.kafka.consumer.group-id:notification-service}")
    public void onMessage(ConsumerRecord<String, String> record) throws JsonProcessingException {
        JsonNode node = objectMapper.readTree(record.value());
        String eventType = node.path("eventType").asText("");
        log.debug("Received {} (key {}) from {}", eventType, record.key(), record.topic());

        if (EventType.NOTIFICATION_REQUESTED.name().equals(eventType)) {
            notificationService.handleNotificationRequested(
                    objectMapper.treeToValue(node, NotificationRequestedEvent.class));
        } else {
            log.trace("Ignoring notification event {}", eventType);
        }
    }
}

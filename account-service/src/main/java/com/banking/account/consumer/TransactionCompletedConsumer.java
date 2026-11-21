package com.banking.account.consumer;

import com.banking.account.entity.BalanceUpdateOutcome;
import com.banking.account.event.BalanceUpdateRequestedEvent;
import com.banking.account.service.AccountBalanceService;
import com.banking.common.event.EventType;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Listens to {@code banking.transaction.events} and reacts to BALANCE_UPDATE_REQUESTED — the
 * step of the transaction saga where account-service actually moves the money.
 * (The class keeps its original name from the project skeleton.)
 * <p>
 * Every message on the topic arrives here; we read the {@code eventType} field and ignore the
 * types we don't care about (TRANSACTION_INITIATED, TRANSACTION_COMPLETED, ...).
 * The real work, including idempotency, happens in {@link AccountBalanceService#applyBalanceUpdate}.
 * If that throws (e.g. database down), the error handler retries and finally sends the message
 * to the dead-letter topic.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TransactionCompletedConsumer {

    private final ObjectMapper objectMapper;
    private final AccountBalanceService accountBalanceService;

    @KafkaListener(topics = EventType.Topics.TRANSACTION, groupId = "${spring.kafka.consumer.group-id:account-service}")
    public void onTransactionEvent(ConsumerRecord<String, String> record) throws JsonProcessingException {
        handle(record.value());
    }

    /** Parses and dispatches one message. Public so it can be unit-tested without Kafka. */
    public void handle(String payload) throws JsonProcessingException {
        JsonNode node = objectMapper.readTree(payload);
        String eventType = node.path("eventType").asText("");
        if (!EventType.BALANCE_UPDATE_REQUESTED.name().equals(eventType)) {
            log.debug("Ignoring {} event", eventType.isEmpty() ? "untyped" : eventType);
            return;
        }
        BalanceUpdateRequestedEvent event = objectMapper.treeToValue(node, BalanceUpdateRequestedEvent.class);
        log.info("Received BALANCE_UPDATE_REQUESTED for transaction {} ({} {} {})", event.getTransactionId(),
                event.getTransactionType(), event.getAmount(), event.getCurrency());
        BalanceUpdateOutcome outcome = accountBalanceService.applyBalanceUpdate(event);
        log.debug("Transaction {} handled with outcome {}", event.getTransactionId(),
                outcome == null ? "DUPLICATE" : outcome);
    }
}

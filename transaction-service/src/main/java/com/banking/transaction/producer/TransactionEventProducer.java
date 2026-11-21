package com.banking.transaction.producer;

import com.banking.common.event.BaseEvent;
import com.banking.transaction.entity.OutboxEvent;
import com.banking.transaction.entity.OutboxStatus;
import com.banking.transaction.exception.TransactionProcessingException;
import com.banking.transaction.repository.OutboxEventRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

/**
 * "Publishes" an event by writing it to the outbox table - it does NOT talk to Kafka.
 * <p>
 * {@code Propagation.MANDATORY} makes sure it is always called inside the caller's DB transaction,
 * so the outbox row commits (or rolls back) together with the business change.
 * {@link OutboxEventRelay} sends the row to Kafka afterwards.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TransactionEventProducer {

    public static final String AGGREGATE_TYPE = "Transaction";

    private final OutboxEventRepository outboxEventRepository;
    private final ObjectMapper objectMapper;

    @Transactional(propagation = Propagation.MANDATORY)
    public OutboxEvent publish(BaseEvent event) {
        String payload;
        try {
            payload = objectMapper.writeValueAsString(event);
        } catch (JsonProcessingException e) {
            throw new TransactionProcessingException("Could not serialize event " + event.getEventType(), e);
        }
        OutboxEvent outbox = OutboxEvent.builder()
                .aggregateType(AGGREGATE_TYPE)
                .aggregateId(event.getAggregateId())
                .eventType(event.getEventType().name())
                .topic(event.topic())
                .payload(payload)
                .status(OutboxStatus.PENDING)
                .attempts(0)
                .createdAt(Instant.now())
                .build();
        OutboxEvent saved = outboxEventRepository.save(outbox);
        log.debug("Queued {} for transaction {} in the outbox", event.getEventType(), event.getAggregateId());
        return saved;
    }
}

package com.banking.account.producer;

import com.banking.account.entity.OutboxEvent;
import com.banking.account.repository.OutboxEventRepository;
import com.banking.common.event.BaseEvent;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * "Publishes" account events by writing them to the outbox table.
 * <p>
 * It does NOT talk to Kafka directly. {@code Propagation.MANDATORY} forces callers to already be
 * inside a transaction, so the outbox row is committed (or rolled back) together with the
 * business change. {@link OutboxEventRelay} sends the rows to Kafka afterwards.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AccountEventProducer {

    public static final String AGGREGATE_ACCOUNT = "Account";
    public static final String AGGREGATE_TRANSACTION = "Transaction";

    private final OutboxEventRepository outboxEventRepository;
    private final ObjectMapper objectMapper;

    @Transactional(propagation = Propagation.MANDATORY)
    public OutboxEvent publish(BaseEvent event, String aggregateType) {
        OutboxEvent row = OutboxEvent.builder()
                .aggregateType(aggregateType)
                .aggregateId(event.getAggregateId())
                .eventType(event.getEventType().name())
                .topic(event.topic())
                .payload(toJson(event))
                .build();
        OutboxEvent saved = outboxEventRepository.save(row);
        log.debug("Queued {} for aggregate {} in outbox", event.getEventType(), event.getAggregateId());
        return saved;
    }

    private String toJson(BaseEvent event) {
        try {
            return objectMapper.writeValueAsString(event);
        } catch (JsonProcessingException e) {
            throw new BankingException(ErrorCode.INTERNAL_ERROR, "Could not serialize event " + event.getEventType(), e);
        }
    }
}

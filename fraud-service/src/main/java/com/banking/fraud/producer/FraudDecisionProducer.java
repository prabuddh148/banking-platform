package com.banking.fraud.producer;

import com.banking.common.event.BaseEvent;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Publishes fraud events to Kafka (topic from the event type, key = aggregateId = transactionId,
 * value = JSON). The send is synchronous (waits up to 10s for the broker's ack) so that a failure
 * surfaces as an exception and rolls back the surrounding database transaction.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FraudDecisionProducer {

    private static final long SEND_TIMEOUT_SECONDS = 10;

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;

    public void publish(BaseEvent event) {
        try {
            String payload = objectMapper.writeValueAsString(event);
            kafkaTemplate.send(event.topic(), event.getAggregateId(), payload)
                    .get(SEND_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            log.info("Published {} for transaction {} (eventId={})",
                    event.getEventType(), event.getAggregateId(), event.getEventId());
        } catch (JsonProcessingException e) {
            throw new BankingException(ErrorCode.INTERNAL_ERROR, "Could not serialize " + event.getEventType(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BankingException(ErrorCode.SERVICE_UNAVAILABLE, "Interrupted while publishing event", e);
        } catch (ExecutionException | TimeoutException e) {
            throw new BankingException(ErrorCode.SERVICE_UNAVAILABLE,
                    "Could not publish " + event.getEventType() + " to Kafka", e);
        }
    }
}

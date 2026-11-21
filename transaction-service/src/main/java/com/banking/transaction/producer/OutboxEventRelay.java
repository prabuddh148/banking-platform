package com.banking.transaction.producer;

import com.banking.transaction.entity.OutboxEvent;
import com.banking.transaction.entity.OutboxStatus;
import com.banking.transaction.repository.OutboxEventRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Background job that moves outbox rows to Kafka.
 * <p>
 * Every {@code outbox.relay.interval-ms} it takes up to 100 PENDING rows (oldest first), sends each
 * one and waits up to 10s for Kafka's acknowledgement. Success: PUBLISHED. Failure: attempts + 1 and
 * the error is remembered; after {@link OutboxEvent#MAX_ATTEMPTS} attempts the row is marked FAILED.
 * The batch stops at the first failure so later events are not sent before earlier ones.
 * A row may be sent twice (e.g. crash right after sending), which is fine because consumers are idempotent.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class OutboxEventRelay {

    private static final long SEND_TIMEOUT_SECONDS = 10;
    private static final int MAX_ERROR_LENGTH = 1000;

    private final OutboxEventRepository outboxEventRepository;
    private final KafkaTemplate<String, String> kafkaTemplate;

    @Scheduled(fixedDelayString = "${outbox.relay.interval-ms:2000}")
    public void publishPendingEvents() {
        List<OutboxEvent> batch = outboxEventRepository.findTop100ByStatusOrderByCreatedAtAsc(OutboxStatus.PENDING);
        for (OutboxEvent event : batch) {
            if (!publish(event)) {
                break;
            }
        }
    }

    /** @return true if the event was sent */
    boolean publish(OutboxEvent event) {
        try {
            kafkaTemplate.send(event.getTopic(), event.getAggregateId(), event.getPayload())
                    .get(SEND_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            event.setStatus(OutboxStatus.PUBLISHED);
            event.setPublishedAt(Instant.now());
            event.setLastError(null);
            outboxEventRepository.save(event);
            log.debug("Published {} ({}) to {}", event.getEventType(), event.getAggregateId(), event.getTopic());
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            recordFailure(event, e);
            return false;
        } catch (Exception e) {
            recordFailure(event, e);
            return false;
        }
    }

    private void recordFailure(OutboxEvent event, Exception e) {
        event.setAttempts(event.getAttempts() + 1);
        String message = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
        event.setLastError(message.length() > MAX_ERROR_LENGTH ? message.substring(0, MAX_ERROR_LENGTH) : message);
        if (event.getAttempts() >= OutboxEvent.MAX_ATTEMPTS) {
            event.setStatus(OutboxStatus.FAILED);
            log.error("Giving up on outbox event {} ({}) after {} attempts: {}",
                    event.getId(), event.getEventType(), event.getAttempts(), message);
        } else {
            log.warn("Failed to publish outbox event {} ({}), attempt {}: {}",
                    event.getId(), event.getEventType(), event.getAttempts(), message);
        }
        outboxEventRepository.save(event);
    }
}

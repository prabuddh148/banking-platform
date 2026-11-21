package com.banking.account.producer;

import com.banking.account.entity.OutboxEvent;
import com.banking.account.entity.OutboxStatus;
import com.banking.account.repository.OutboxEventRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Background job that moves events from the outbox table to Kafka.
 * <p>
 * Every {@code outbox.relay.interval-ms} (default 2s) it picks up to 100 PENDING rows (oldest
 * first), sends each one and waits for Kafka's acknowledgement (max 10s). Success -> PUBLISHED;
 * failure -> attempts+1 and lastError, and after 5 failed attempts the row becomes FAILED.
 * Delivery is "at least once": consumers de-duplicate using the event id / business key.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class OutboxEventRelay {

    static final int BATCH_SIZE = 100;
    private static final long SEND_TIMEOUT_SECONDS = 10;
    private static final int MAX_ERROR_LENGTH = 2000;

    private final OutboxEventRepository outboxEventRepository;
    private final KafkaTemplate<String, String> kafkaTemplate;

    @Scheduled(fixedDelayString = "${outbox.relay.interval-ms:2000}")
    @Transactional
    public void relayPendingEvents() {
        List<OutboxEvent> batch = outboxEventRepository.lockPendingBatch(BATCH_SIZE);
        if (batch.isEmpty()) {
            return;
        }
        int published = 0;
        for (OutboxEvent event : batch) {
            if (send(event)) {
                published++;
            }
        }
        // Rows are managed entities, so their changes are flushed on commit; saveAll makes it explicit.
        outboxEventRepository.saveAll(batch);
        log.info("Outbox relay: {}/{} events published", published, batch.size());
    }

    /** Sends one row and updates its status. Returns true on success. */
    boolean send(OutboxEvent event) {
        try {
            kafkaTemplate.send(event.getTopic(), event.getAggregateId(), event.getPayload())
                    .get(SEND_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            event.markPublished();
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            event.markAttemptFailed("Interrupted while sending");
        } catch (Exception e) {
            String message = e.getClass().getSimpleName() + ": " + e.getMessage();
            event.markAttemptFailed(message.length() > MAX_ERROR_LENGTH ? message.substring(0, MAX_ERROR_LENGTH) : message);
            if (event.getStatus() == OutboxStatus.FAILED) {
                log.error("Outbox event {} ({}) FAILED permanently after {} attempts: {}",
                        event.getId(), event.getEventType(), event.getAttempts(), message);
            } else {
                log.warn("Outbox event {} ({}) send attempt {} failed: {}",
                        event.getId(), event.getEventType(), event.getAttempts(), message);
            }
        }
        return false;
    }
}

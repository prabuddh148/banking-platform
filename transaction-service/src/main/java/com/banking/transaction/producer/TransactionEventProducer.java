package com.banking.transaction.producer;

import com.banking.transaction.event.TransactionCompletedEvent;
import com.banking.transaction.event.TransactionFailedEvent;
import com.banking.transaction.event.TransactionInitiatedEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
@Slf4j
@RequiredArgsConstructor
public class TransactionEventProducer {

    private static final String TOPIC_INITIATED = "transaction.initiated";
    private static final String TOPIC_COMPLETED = "transaction.completed";
    private static final String TOPIC_FAILED = "transaction.failed";
    private static final String TOPIC_PROCESSING = "transaction.processing";

    private final KafkaTemplate<String, Object> kafkaTemplate;

    public void publishTransactionInitiated(TransactionInitiatedEvent event) {
        String key = event.getTransactionId().toString();
        kafkaTemplate.send(TOPIC_INITIATED, key, event)
                .whenComplete((result, ex) -> {
                    if (ex != null) {
                        log.error("Failed to publish TransactionInitiatedEvent for transactionId={}: {}",
                                event.getTransactionId(), ex.getMessage(), ex);
                    } else {
                        log.info("Published TransactionInitiatedEvent for transactionId={} to topic={}, partition={}, offset={}",
                                event.getTransactionId(), TOPIC_INITIATED,
                                result.getRecordMetadata().partition(),
                                result.getRecordMetadata().offset());
                    }
                });
    }

    public void publishTransactionCompleted(TransactionCompletedEvent event) {
        String key = event.getTransactionId().toString();
        kafkaTemplate.send(TOPIC_COMPLETED, key, event)
                .whenComplete((result, ex) -> {
                    if (ex != null) {
                        log.error("Failed to publish TransactionCompletedEvent for transactionId={}: {}",
                                event.getTransactionId(), ex.getMessage(), ex);
                    } else {
                        log.info("Published TransactionCompletedEvent for transactionId={} to topic={}, partition={}, offset={}",
                                event.getTransactionId(), TOPIC_COMPLETED,
                                result.getRecordMetadata().partition(),
                                result.getRecordMetadata().offset());
                    }
                });
    }

    public void publishTransactionFailed(TransactionFailedEvent event) {
        String key = event.getTransactionId().toString();
        kafkaTemplate.send(TOPIC_FAILED, key, event)
                .whenComplete((result, ex) -> {
                    if (ex != null) {
                        log.error("Failed to publish TransactionFailedEvent for transactionId={}: {}",
                                event.getTransactionId(), ex.getMessage(), ex);
                    } else {
                        log.info("Published TransactionFailedEvent for transactionId={} to topic={}, partition={}, offset={}",
                                event.getTransactionId(), TOPIC_FAILED,
                                result.getRecordMetadata().partition(),
                                result.getRecordMetadata().offset());
                    }
                });
    }

    public void publishTransactionProcessing(UUID transactionId, String step) {
        String key = transactionId.toString();
        java.util.Map<String, String> payload = java.util.Map.of(
                "transactionId", transactionId.toString(),
                "step", step
        );
        kafkaTemplate.send(TOPIC_PROCESSING, key, payload)
                .whenComplete((result, ex) -> {
                    if (ex != null) {
                        log.error("Failed to publish processing event for transactionId={}, step={}: {}",
                                transactionId, step, ex.getMessage(), ex);
                    } else {
                        log.info("Published processing event for transactionId={}, step={} to topic={}",
                                transactionId, step, TOPIC_PROCESSING);
                    }
                });
    }
}

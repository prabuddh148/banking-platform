package com.banking.audit.config;

import com.banking.common.event.EventType;
import com.fasterxml.jackson.core.JsonProcessingException;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.common.TopicPartition;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

/**
 * Kafka consumer error handling.
 * <p>
 * Consumer factory and listener container come from Spring Boot auto-configuration (see application.yml:
 * String deserializers, ack-mode record, auto-offset-reset earliest). Boot automatically plugs the
 * {@link DefaultErrorHandler} bean below into the listener container factory.
 * <p>
 * What happens when a listener throws:
 * <ul>
 *   <li>Normal errors (e.g. database briefly down) are retried 3 times, 1 second apart.</li>
 *   <li>Messages that can never succeed (invalid JSON, missing eventId) are not retried.</li>
 *   <li>After that the message is published to {@code <topic>.DLT} so it is not lost and the
 *       consumer can move on to the next message.</li>
 * </ul>
 */
@Slf4j
@Configuration
public class KafkaConsumerConfig {

    @Bean
    public DefaultErrorHandler kafkaErrorHandler(KafkaTemplate<String, String> kafkaTemplate) {
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(kafkaTemplate,
                (record, ex) -> {
                    log.error("Sending message from topic {} (offset {}) to DLT: {}",
                            record.topic(), record.offset(), ex.getMessage());
                    return new TopicPartition(record.topic() + EventType.Topics.DLT_SUFFIX, -1);
                });

        DefaultErrorHandler errorHandler = new DefaultErrorHandler(recoverer, new FixedBackOff(1000L, 3));
        // A broken message stays broken: skip the retries and dead-letter it straight away.
        errorHandler.addNotRetryableExceptions(JsonProcessingException.class, IllegalArgumentException.class);
        return errorHandler;
    }
}

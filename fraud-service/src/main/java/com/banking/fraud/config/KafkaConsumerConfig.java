package com.banking.fraud.config;

import com.fasterxml.jackson.core.JsonProcessingException;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.common.TopicPartition;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

import static com.banking.common.event.EventType.Topics.DLT_SUFFIX;

/**
 * Consumer-side Kafka setup.
 * <p>
 * The consumer factory and listener container factory come from Spring Boot's auto-configuration
 * (see {@code spring.kafka.consumer.*} in application.yml). Boot automatically plugs the
 * {@link DefaultErrorHandler} bean below into the listener container: a failing record is retried
 * 3 times, 1 second apart, and then published to {@code <topic>.DLT} so it does not block the partition.
 */
@Slf4j
@Configuration
public class KafkaConsumerConfig {

    @Bean
    public DefaultErrorHandler kafkaErrorHandler(KafkaTemplate<String, String> kafkaTemplate) {
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(kafkaTemplate,
                (record, ex) -> {
                    log.error("Sending record from {} (key={}) to DLT: {}", record.topic(), record.key(), ex.getMessage());
                    return new TopicPartition(record.topic() + DLT_SUFFIX, record.partition());
                });
        DefaultErrorHandler handler = new DefaultErrorHandler(recoverer, new FixedBackOff(1000L, 3));
        // Retrying cannot fix a malformed message, so send those to the DLT straight away.
        handler.addNotRetryableExceptions(JsonProcessingException.class, IllegalArgumentException.class);
        return handler;
    }
}

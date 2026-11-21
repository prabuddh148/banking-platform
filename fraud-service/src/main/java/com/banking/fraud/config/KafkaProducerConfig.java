package com.banking.fraud.config;

import com.banking.common.event.EventType;
import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;

/**
 * Producer-side Kafka setup.
 * <p>
 * The {@code KafkaTemplate<String, String>} itself is auto-configured by Spring Boot from
 * {@code spring.kafka.producer.*} (String serializers, acks=all, idempotence on).
 * Here we only declare the topics this service owns; Spring's KafkaAdmin creates them on startup
 * if they do not exist yet.
 */
@Configuration
public class KafkaProducerConfig {

    private static final int PARTITIONS = 3;
    private static final int REPLICAS = 1;

    @Bean
    public NewTopic fraudEventsTopic() {
        return TopicBuilder.name(EventType.Topics.FRAUD).partitions(PARTITIONS).replicas(REPLICAS).build();
    }

    @Bean
    public NewTopic fraudEventsDeadLetterTopic() {
        return TopicBuilder.name(EventType.Topics.FRAUD + EventType.Topics.DLT_SUFFIX)
                .partitions(PARTITIONS).replicas(REPLICAS).build();
    }

    /** Our consumer sends failed transaction events here, so make sure it exists. */
    @Bean
    public NewTopic transactionEventsDeadLetterTopic() {
        return TopicBuilder.name(EventType.Topics.TRANSACTION + EventType.Topics.DLT_SUFFIX)
                .partitions(PARTITIONS).replicas(REPLICAS).build();
    }
}

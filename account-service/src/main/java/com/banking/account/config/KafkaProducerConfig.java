package com.banking.account.config;

import com.banking.common.event.EventType;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringSerializer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.core.ProducerFactory;

import java.util.HashMap;
import java.util.Map;

/**
 * Kafka producer setup. Messages are plain JSON strings (key = aggregateId).
 * {@code acks=all} + idempotence: the broker confirms only after all replicas have the message,
 * and retries never create duplicates inside Kafka.
 * Also declares the topics this service owns, so they exist with 3 partitions.
 */
@Configuration
public class KafkaProducerConfig {

    private static final int PARTITIONS = 3;
    private static final int REPLICAS = 1;

    @Value("${spring.kafka.bootstrap-servers:localhost:9092}")
    private String bootstrapServers;

    @Bean
    public ProducerFactory<String, String> producerFactory() {
        Map<String, Object> props = new HashMap<>();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        props.put(ProducerConfig.ACKS_CONFIG, "all");
        props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
        props.put(ProducerConfig.RETRIES_CONFIG, 3);
        return new DefaultKafkaProducerFactory<>(props);
    }

    @Bean
    public KafkaTemplate<String, String> kafkaTemplate(ProducerFactory<String, String> producerFactory) {
        return new KafkaTemplate<>(producerFactory);
    }

    /** Topic for everything account-service publishes. */
    @Bean
    public NewTopic accountEventsTopic() {
        return TopicBuilder.name(EventType.Topics.ACCOUNT).partitions(PARTITIONS).replicas(REPLICAS).build();
    }

    @Bean
    public NewTopic accountEventsDltTopic() {
        return TopicBuilder.name(EventType.Topics.ACCOUNT + EventType.Topics.DLT_SUFFIX)
                .partitions(PARTITIONS).replicas(REPLICAS).build();
    }

    /** Dead-letter topic our consumer writes to when a transaction event can't be processed. */
    @Bean
    public NewTopic transactionEventsDltTopic() {
        return TopicBuilder.name(EventType.Topics.TRANSACTION + EventType.Topics.DLT_SUFFIX)
                .partitions(PARTITIONS).replicas(REPLICAS).build();
    }
}

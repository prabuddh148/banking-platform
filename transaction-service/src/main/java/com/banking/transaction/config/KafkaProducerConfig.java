package com.banking.transaction.config;

import com.banking.common.event.EventType;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringSerializer;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.kafka.KafkaProperties;
import org.springframework.boot.ssl.SslBundles;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.core.ProducerFactory;

import java.util.HashMap;
import java.util.Map;

/**
 * Kafka producer setup.
 * <p>
 * Messages are plain JSON strings (key = aggregateId). The producer is configured for
 * durability: {@code acks=all} and idempotence on, so a retry never writes a duplicate.
 * Also declares the topics this service owns (Spring's KafkaAdmin creates them on startup if missing).
 */
@Configuration
public class KafkaProducerConfig {

    private static final int PARTITIONS = 3;
    private static final int REPLICAS = 1;

    @Bean
    public ProducerFactory<String, String> producerFactory(KafkaProperties kafkaProperties,
                                                           ObjectProvider<SslBundles> sslBundles) {
        Map<String, Object> props = new HashMap<>(kafkaProperties.buildProducerProperties(sslBundles.getIfAvailable()));
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        props.put(ProducerConfig.ACKS_CONFIG, "all");
        props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
        return new DefaultKafkaProducerFactory<>(props);
    }

    @Bean
    public KafkaTemplate<String, String> kafkaTemplate(ProducerFactory<String, String> producerFactory) {
        return new KafkaTemplate<>(producerFactory);
    }

    /** Topic owned by this service. */
    @Bean
    public NewTopic transactionEventsTopic() {
        return TopicBuilder.name(EventType.Topics.TRANSACTION).partitions(PARTITIONS).replicas(REPLICAS).build();
    }

    @Bean
    public NewTopic transactionEventsDltTopic() {
        return TopicBuilder.name(EventType.Topics.TRANSACTION + EventType.Topics.DLT_SUFFIX)
                .partitions(PARTITIONS).replicas(REPLICAS).build();
    }

    /** Dead-letter topics for the topics we consume (our error handler writes there). */
    @Bean
    public NewTopic accountEventsDltTopic() {
        return TopicBuilder.name(EventType.Topics.ACCOUNT + EventType.Topics.DLT_SUFFIX)
                .partitions(PARTITIONS).replicas(REPLICAS).build();
    }

    @Bean
    public NewTopic fraudEventsDltTopic() {
        return TopicBuilder.name(EventType.Topics.FRAUD + EventType.Topics.DLT_SUFFIX)
                .partitions(PARTITIONS).replicas(REPLICAS).build();
    }
}

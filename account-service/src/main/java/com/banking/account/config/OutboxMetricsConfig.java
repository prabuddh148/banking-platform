package com.banking.account.config;

import com.banking.account.entity.OutboxStatus;
import com.banking.account.repository.OutboxEventRepository;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Publishes the gauge {@code outbox.events.pending} (Prometheus: {@code outbox_events_pending}) =
 * number of outbox rows still waiting to be sent to Kafka. A value that keeps growing means the
 * relay can't reach Kafka; dashboards and alerts use it.
 * Also exposes {@code outbox.events.failed} for rows that were given up.
 */
@Configuration
public class OutboxMetricsConfig {

    @Bean
    public Gauge outboxPendingGauge(MeterRegistry registry, OutboxEventRepository repository) {
        return Gauge.builder("outbox.events.pending", repository, r -> r.countByStatus(OutboxStatus.PENDING))
                .description("Outbox events waiting to be published to Kafka")
                .tag("service", "account-service")
                .register(registry);
    }

    @Bean
    public Gauge outboxFailedGauge(MeterRegistry registry, OutboxEventRepository repository) {
        return Gauge.builder("outbox.events.failed", repository, r -> r.countByStatus(OutboxStatus.FAILED))
                .description("Outbox events that permanently failed to publish")
                .tag("service", "account-service")
                .register(registry);
    }
}

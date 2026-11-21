package com.banking.transaction.producer;

import com.banking.transaction.entity.OutboxStatus;
import com.banking.transaction.repository.OutboxEventRepository;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.binder.MeterBinder;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Registers the {@code outbox.events.pending} gauge (Prometheus: {@code outbox_events_pending}):
 * how many outbox rows are still waiting to be sent to Kafka. If it keeps growing, the relay
 * can't reach Kafka. Spring Boot picks up every {@link MeterBinder} bean automatically.
 * The value is read from the database each time the metric is scraped.
 */
@Component
@RequiredArgsConstructor
public class OutboxMetrics implements MeterBinder {

    public static final String PENDING_GAUGE = "outbox.events.pending";

    private final OutboxEventRepository outboxEventRepository;

    @Override
    public void bindTo(MeterRegistry registry) {
        Gauge.builder(PENDING_GAUGE, outboxEventRepository, repo -> repo.countByStatus(OutboxStatus.PENDING))
                .description("Number of outbox events waiting to be published to Kafka")
                .register(registry);
    }
}

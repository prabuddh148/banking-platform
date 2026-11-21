package com.banking.transaction.repository;

import com.banking.transaction.entity.OutboxEvent;
import com.banking.transaction.entity.OutboxStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/** Data access for {@link OutboxEvent}. */
public interface OutboxEventRepository extends JpaRepository<OutboxEvent, UUID> {

    /** Next batch to publish, oldest first so events keep their order. */
    List<OutboxEvent> findTop100ByStatusOrderByCreatedAtAsc(OutboxStatus status);

    /** Backs the {@code outbox.events.pending} metric. */
    long countByStatus(OutboxStatus status);
}

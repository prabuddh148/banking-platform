package com.banking.account.repository;

import com.banking.account.entity.OutboxEvent;
import com.banking.account.entity.OutboxStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

/**
 * Outbox rows waiting to be relayed to Kafka.
 */
public interface OutboxEventRepository extends JpaRepository<OutboxEvent, UUID> {

    /**
     * Oldest PENDING rows first. {@code FOR UPDATE SKIP LOCKED} means that if two instances of
     * the service run the relay at the same time they pick different rows instead of sending
     * the same event twice.
     */
    @Query(value = "SELECT * FROM outbox_events WHERE status = 'PENDING' "
            + "ORDER BY created_at LIMIT :limit FOR UPDATE SKIP LOCKED", nativeQuery = true)
    List<OutboxEvent> lockPendingBatch(@Param("limit") int limit);

    long countByStatus(OutboxStatus status);
}

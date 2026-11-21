package com.banking.notification.repository;

import com.banking.notification.entity.ProcessedEvent;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Database access for {@link ProcessedEvent} (idempotency of the Kafka consumers).
 */
public interface ProcessedEventRepository extends JpaRepository<ProcessedEvent, String> {
}

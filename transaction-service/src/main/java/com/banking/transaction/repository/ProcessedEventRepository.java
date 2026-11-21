package com.banking.transaction.repository;

import com.banking.transaction.entity.ProcessedEvent;
import org.springframework.data.jpa.repository.JpaRepository;

/** Data access for {@link ProcessedEvent} (consumer de-duplication). */
public interface ProcessedEventRepository extends JpaRepository<ProcessedEvent, String> {
}

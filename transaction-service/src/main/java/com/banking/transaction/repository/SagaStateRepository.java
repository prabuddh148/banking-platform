package com.banking.transaction.repository;

import com.banking.transaction.entity.SagaState;
import com.banking.transaction.entity.SagaStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Data access for {@link SagaState}. */
public interface SagaStateRepository extends JpaRepository<SagaState, UUID> {

    Optional<SagaState> findByTransactionId(UUID transactionId);

    /** Sagas in one of the given states that haven't moved since {@code cutoff} (timeout job). */
    List<SagaState> findByStatusInAndUpdatedAtBefore(Collection<SagaStatus> statuses, Instant cutoff);
}

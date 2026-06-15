package com.banking.transaction.repository;

import com.banking.transaction.entity.SagaState;
import com.banking.transaction.entity.SagaStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface SagaStateRepository extends JpaRepository<SagaState, UUID> {

    Optional<SagaState> findByTransactionId(UUID transactionId);

    List<SagaState> findBySagaStatusIn(List<SagaStatus> statuses);
}

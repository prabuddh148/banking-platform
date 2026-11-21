package com.banking.account.repository;

import com.banking.account.entity.BalanceReservation;
import com.banking.account.entity.ReservationStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * Holds placed on account funds.
 */
public interface BalanceReservationRepository extends JpaRepository<BalanceReservation, UUID> {

    Optional<BalanceReservation> findByAccountIdAndTransactionId(UUID accountId, String transactionId);

    Optional<BalanceReservation> findByAccountIdAndTransactionIdAndStatus(UUID accountId, String transactionId,
                                                                          ReservationStatus status);
}

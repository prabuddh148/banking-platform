package com.banking.account.repository;

import com.banking.account.entity.AccountBalance;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

/**
 * Balance rows. {@link #findByIdForUpdate} takes a pessimistic write lock
 * (SELECT ... FOR UPDATE): other transactions that want the same row wait until we commit.
 * Callers that lock several rows must always lock them in the same order (by id) to avoid deadlocks.
 */
public interface AccountBalanceRepository extends JpaRepository<AccountBalance, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select b from AccountBalance b join fetch b.account where b.accountId = :accountId")
    Optional<AccountBalance> findByIdForUpdate(@Param("accountId") UUID accountId);

    @Query("select b from AccountBalance b join fetch b.account where b.accountId = :accountId")
    Optional<AccountBalance> findWithAccountById(@Param("accountId") UUID accountId);
}

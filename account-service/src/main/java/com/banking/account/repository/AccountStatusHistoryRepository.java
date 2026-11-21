package com.banking.account.repository;

import com.banking.account.entity.AccountStatusHistory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/**
 * Status-change history of accounts.
 */
public interface AccountStatusHistoryRepository extends JpaRepository<AccountStatusHistory, UUID> {

    List<AccountStatusHistory> findByAccountIdOrderByChangedAtAsc(UUID accountId);
}

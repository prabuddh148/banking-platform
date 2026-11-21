package com.banking.account.repository;

import com.banking.account.entity.Account;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;
import java.util.UUID;

/**
 * Accounts table. {@link JpaSpecificationExecutor} lets the service build optional filters
 * (customerId, status) for the list endpoint.
 */
public interface AccountRepository extends JpaRepository<Account, UUID>, JpaSpecificationExecutor<Account> {

    @EntityGraph(attributePaths = "balance")
    Optional<Account> findWithBalanceById(UUID id);

    @EntityGraph(attributePaths = "balance")
    Optional<Account> findByAccountNumber(String accountNumber);

    boolean existsByAccountNumber(String accountNumber);

    /** Same as the inherited method but also loads the balance in the same query (avoids N+1). */
    @Override
    @EntityGraph(attributePaths = "balance")
    Page<Account> findAll(Specification<Account> spec, Pageable pageable);
}

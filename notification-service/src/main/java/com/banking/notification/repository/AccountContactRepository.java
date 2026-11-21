package com.banking.notification.repository;

import com.banking.notification.entity.AccountContact;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

/**
 * Database access for {@link AccountContact} (accountId -> owner contact details).
 */
public interface AccountContactRepository extends JpaRepository<AccountContact, String> {

    /** Most recently updated contact of a customer (a customer can own several accounts). */
    Optional<AccountContact> findFirstByCustomerIdOrderByUpdatedAtDesc(String customerId);
}

package com.banking.notification.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

import java.time.Instant;

/**
 * Local copy of "who owns this account and how do we reach them".
 * <p>
 * Transaction events only carry account ids, so when ACCOUNT_CREATED arrives we remember the
 * owner's contact details here. Later TRANSACTION_* events look the contacts up by account id.
 * (Each microservice keeps the data it needs instead of calling account-service synchronously.)
 */
@Entity
@Table(name = "account_contacts")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@ToString
public class AccountContact {

    @Id
    @Column(name = "account_id", length = 64)
    private String accountId;

    @Column(name = "account_number", length = 32)
    private String accountNumber;

    @Column(name = "customer_id", nullable = false, length = 64)
    private String customerId;

    @Column(name = "customer_name", length = 200)
    private String customerName;

    @Column(length = 255)
    private String email;

    @Column(length = 32)
    private String phone;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }
}

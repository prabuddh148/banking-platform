package com.banking.transaction.repository;

import com.banking.transaction.entity.Transaction;
import com.banking.transaction.entity.TransactionStatus;
import com.banking.transaction.entity.TransactionType;
import org.springframework.data.jpa.domain.Specification;

/**
 * Reusable WHERE-clause pieces for searching transactions. Each method returns a no-op
 * (null) specification when its filter value is null, so callers can just chain them with {@code and}.
 */
public final class TransactionSpecifications {

    private TransactionSpecifications() {
    }

    public static Specification<Transaction> initiatedBy(String userId) {
        return (root, query, cb) -> userId == null ? null : cb.equal(root.get("initiatedBy"), userId);
    }

    /** Transaction touches the account, as source or destination. */
    public static Specification<Transaction> involvesAccount(String accountId) {
        return (root, query, cb) -> accountId == null ? null : cb.or(
                cb.equal(root.get("sourceAccountId"), accountId),
                cb.equal(root.get("destinationAccountId"), accountId));
    }

    public static Specification<Transaction> hasStatus(TransactionStatus status) {
        return (root, query, cb) -> status == null ? null : cb.equal(root.get("status"), status);
    }

    public static Specification<Transaction> hasType(TransactionType type) {
        return (root, query, cb) -> type == null ? null : cb.equal(root.get("transactionType"), type);
    }
}

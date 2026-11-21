package com.banking.notification.repository;

import com.banking.notification.entity.Notification;
import com.banking.notification.entity.NotificationChannel;
import com.banking.notification.entity.NotificationStatus;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Database access for {@link Notification}.
 * <p>
 * {@link JpaSpecificationExecutor} lets the list endpoint combine optional filters
 * (recipient, status, channel) without writing one query per combination.
 */
public interface NotificationRepository extends JpaRepository<Notification, UUID>,
        JpaSpecificationExecutor<Notification> {

    /** Failed notifications that still have attempts left, oldest first (used by the retry job). */
    List<Notification> findTop50ByStatusAndAttemptsLessThanOrderByCreatedAtAsc(NotificationStatus status,
                                                                               int maxAttempts);

    /** Filters for the list endpoint; a null argument means "don't filter on this". */
    static Specification<Notification> withFilters(String recipientId, NotificationStatus status,
                                                   NotificationChannel channel) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (recipientId != null && !recipientId.isBlank()) {
                predicates.add(cb.equal(root.get("recipientId"), recipientId));
            }
            if (status != null) {
                predicates.add(cb.equal(root.get("status"), status));
            }
            if (channel != null) {
                predicates.add(cb.equal(root.get("channel"), channel));
            }
            return cb.and(predicates.toArray(Predicate[]::new));
        };
    }
}

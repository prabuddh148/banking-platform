package com.banking.audit.repository;

import com.banking.audit.entity.AuditEventType;
import com.banking.audit.entity.AuditLog;
import com.banking.audit.entity.AuditSeverity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.criteria.Predicate;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Database access for {@link AuditLog}.
 * <ul>
 *   <li>Simple lookups are derived query methods (Spring Data builds the SQL from the method name).</li>
 *   <li>The multi-filter search uses JPA Specifications (see {@link #filter}) via {@link JpaSpecificationExecutor}.</li>
 *   <li>The summary uses JPQL {@code GROUP BY} queries.</li>
 * </ul>
 */
public interface AuditLogRepository extends JpaRepository<AuditLog, UUID>, JpaSpecificationExecutor<AuditLog> {

    boolean existsByEventId(String eventId);

    Page<AuditLog> findByAggregateId(String aggregateId, Pageable pageable);

    Page<AuditLog> findByActor(String actor, Pageable pageable);

    Page<AuditLog> findByCorrelationId(String correlationId, Pageable pageable);

    @Query("select count(a) from AuditLog a where a.occurredAt >= :from and a.occurredAt <= :to")
    long countInRange(@Param("from") Instant from, @Param("to") Instant to);

    /** Rows of [AuditEventType, Long]. */
    @Query("""
            select a.eventType, count(a) from AuditLog a
            where a.occurredAt >= :from and a.occurredAt <= :to
            group by a.eventType
            """)
    List<Object[]> countByEventType(@Param("from") Instant from, @Param("to") Instant to);

    /** Rows of [AuditSeverity, Long]. */
    @Query("""
            select a.severity, count(a) from AuditLog a
            where a.occurredAt >= :from and a.occurredAt <= :to
            group by a.severity
            """)
    List<Object[]> countBySeverity(@Param("from") Instant from, @Param("to") Instant to);

    /**
     * Builds a WHERE clause from the optional filters of GET /logs. A null argument means "don't filter on it".
     */
    static Specification<AuditLog> filter(AuditEventType eventType, String aggregateId, String actor,
                                          AuditSeverity severity, Instant from, Instant to) {
        return (root, query, cb) -> {
            var predicates = new ArrayList<Predicate>();
            if (eventType != null) {
                predicates.add(cb.equal(root.get("eventType"), eventType));
            }
            if (aggregateId != null && !aggregateId.isBlank()) {
                predicates.add(cb.equal(root.get("aggregateId"), aggregateId));
            }
            if (actor != null && !actor.isBlank()) {
                predicates.add(cb.equal(root.get("actor"), actor));
            }
            if (severity != null) {
                predicates.add(cb.equal(root.get("severity"), severity));
            }
            if (from != null) {
                predicates.add(cb.greaterThanOrEqualTo(root.get("occurredAt"), from));
            }
            if (to != null) {
                predicates.add(cb.lessThanOrEqualTo(root.get("occurredAt"), to));
            }
            return cb.and(predicates.toArray(new Predicate[0]));
        };
    }
}

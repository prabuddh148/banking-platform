package com.banking.fraud.repository;

import com.banking.fraud.entity.AlertStatus;
import com.banking.fraud.entity.FraudAlert;
import com.banking.fraud.entity.RiskLevel;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

/**
 * Database access for {@link FraudAlert}.
 */
public interface FraudAlertRepository extends JpaRepository<FraudAlert, UUID> {

    Optional<FraudAlert> findByTransactionId(String transactionId);

    /** Both filters are optional: pass null to ignore one. */
    @Query("""
            select a from FraudAlert a
            where (:status is null or a.status = :status)
              and (:riskLevel is null or a.riskLevel = :riskLevel)
            """)
    Page<FraudAlert> search(@Param("status") AlertStatus status,
                            @Param("riskLevel") RiskLevel riskLevel,
                            Pageable pageable);

    long countByStatus(AlertStatus status);
}

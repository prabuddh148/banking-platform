package com.banking.transaction.saga;

import com.banking.common.event.BaseEvent;
import com.banking.common.exception.ErrorCode;
import com.banking.transaction.entity.ProcessedEvent;
import com.banking.transaction.entity.SagaState;
import com.banking.transaction.entity.SagaStatus;
import com.banking.transaction.entity.Transaction;
import com.banking.transaction.entity.TransactionAudit;
import com.banking.transaction.entity.TransactionStatus;
import com.banking.transaction.entity.TransactionStatusHistory;
import com.banking.transaction.event.BalanceUpdateFailedEvent;
import com.banking.transaction.event.BalanceUpdateRequestedEvent;
import com.banking.transaction.event.BalanceUpdatedEvent;
import com.banking.transaction.event.EventSources;
import com.banking.transaction.event.FraudDecisionReceivedEvent;
import com.banking.transaction.event.TransactionCompletedEvent;
import com.banking.transaction.event.TransactionFailedEvent;
import com.banking.transaction.event.TransactionInitiatedEvent;
import com.banking.transaction.producer.TransactionEventProducer;
import com.banking.transaction.repository.ProcessedEventRepository;
import com.banking.transaction.repository.SagaStateRepository;
import com.banking.transaction.repository.TransactionAuditRepository;
import com.banking.transaction.repository.TransactionRepository;
import com.banking.transaction.repository.TransactionStatusHistoryRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * The heart of transaction-service: drives the saga of every transaction.
 * <p>
 * ALL status changes of a transaction and its saga happen in this class, each one together with
 * (in the same DB transaction): a {@link TransactionStatusHistory} row, a {@link TransactionAudit}
 * row and, when the next service must act, an outbox event.
 * <pre>
 * start            : PENDING      / AWAITING_FRAUD_CHECK     -> TRANSACTION_INITIATED
 * fraud APPROVE    : PROCESSING   / AWAITING_BALANCE_UPDATE  -> BALANCE_UPDATE_REQUESTED
 * fraud REVIEW     : UNDER_REVIEW / AWAITING_REVIEW          (wait for an admin)
 * fraud BLOCK      : FAILED       / FAILED                   -> TRANSACTION_FAILED (FRAUD_BLOCKED)
 * balance updated  : COMPLETED    / COMPLETED                -> TRANSACTION_COMPLETED
 * balance failed   : FAILED       / FAILED                   -> TRANSACTION_FAILED (account-service's code)
 * timeout job      : FAILED       / FAILED                   -> TRANSACTION_FAILED (TRANSACTION_FAILED)
 * </pre>
 * Incoming events are de-duplicated by eventId ({@code processed_events}). Events for unknown
 * transactions, or that don't fit the current state (late / out of order), are logged and ignored
 * rather than thrown, so they don't end up retried and dead-lettered for nothing.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TransactionSagaOrchestrator {

    static final String SAGA_TIMEOUT_REASON = "Saga timed out";
    static final String TIMEOUT_ACTOR = "saga-timeout-job";
    private static final String FRAUD_SERVICE = "fraud-service";
    private static final String ACCOUNT_SERVICE = "account-service";
    private static final int MAX_TEXT_LENGTH = 500;

    /** Saga states the timeout job looks at. AWAITING_REVIEW is excluded: a human may take a while. */
    private static final Set<SagaStatus> TIMEOUT_STATUSES =
            EnumSet.of(SagaStatus.AWAITING_FRAUD_CHECK, SagaStatus.AWAITING_BALANCE_UPDATE);

    private final TransactionRepository transactionRepository;
    private final SagaStateRepository sagaStateRepository;
    private final TransactionStatusHistoryRepository historyRepository;
    private final TransactionAuditRepository auditRepository;
    private final ProcessedEventRepository processedEventRepository;
    private final TransactionEventProducer eventProducer;

    /** Minutes a saga may wait for fraud-service / account-service before it is failed. */
    @Value("${saga.timeout-minutes:15}")
    private long timeoutMinutes = 15;

    // ------------------------------------------------------------------ step 1: start

    /**
     * Saves a brand-new transaction as PENDING, creates its saga and queues TRANSACTION_INITIATED.
     *
     * @param transaction fully built transaction (id, reference, amounts...) not yet saved
     */
    @Transactional
    public Transaction startSaga(Transaction transaction) {
        transaction.setStatus(TransactionStatus.PENDING);
        Transaction saved = transactionRepository.save(transaction);
        recordHistory(saved.getId(), null, TransactionStatus.PENDING, "Transaction initiated");

        SagaState saga = SagaState.builder()
                .transactionId(saved.getId())
                .status(SagaStatus.AWAITING_FRAUD_CHECK)
                .currentStep(SagaStep.FRAUD_CHECK)
                .build();
        sagaStateRepository.save(saga);

        audit(saved.getId(), "INITIATED", saved.getInitiatedBy(),
                saved.getTransactionType() + " of " + saved.getAmount() + " " + saved.getCurrency());
        eventProducer.publish(new TransactionInitiatedEvent(saved));
        log.info("Saga started for transaction {} ({} {} {})", saved.getReference(),
                saved.getTransactionType(), saved.getAmount(), saved.getCurrency());
        return saved;
    }

    // ------------------------------------------------------------------ step 2: fraud decision

    /** Handles FRAUD_CLEARED / FRAUD_DETECTED from fraud-service. */
    @Transactional
    public void handleFraudDecision(FraudDecisionReceivedEvent event) {
        if (!markProcessed(event)) {
            return;
        }
        Optional<SagaContext> context = load(event.getTransactionId(), event);
        if (context.isEmpty()) {
            return;
        }
        Transaction tx = context.get().transaction();
        SagaState saga = context.get().saga();

        if (event.getDecision() == null) {
            log.warn("Ignoring {} for transaction {}: no decision in event", event.getEventType(), tx.getId());
            return;
        }
        String actor = event.getReviewedBy() != null ? event.getReviewedBy() : FRAUD_SERVICE;

        switch (event.getDecision()) {
            case APPROVE -> {
                if (!isIn(tx, event, TransactionStatus.PENDING, TransactionStatus.UNDER_REVIEW)) {
                    return;
                }
                tx.setRiskScore(event.getRiskScore());
                String reason = event.getReviewedBy() != null
                        ? "Approved after review by " + event.getReviewedBy()
                        : "Fraud check passed (risk score " + event.getRiskScore() + ")";
                changeStatus(tx, TransactionStatus.PROCESSING, reason);
                moveSaga(saga, SagaStatus.AWAITING_BALANCE_UPDATE, SagaStep.BALANCE_UPDATE);
                save(tx, saga);
                audit(tx.getId(), "FRAUD_APPROVED", actor, describe(event));
                eventProducer.publish(new BalanceUpdateRequestedEvent(tx));
                log.info("Transaction {} approved by fraud check, balance update requested", tx.getReference());
            }
            case REVIEW -> {
                if (!isIn(tx, event, TransactionStatus.PENDING)) {
                    return;
                }
                tx.setRiskScore(event.getRiskScore());
                changeStatus(tx, TransactionStatus.UNDER_REVIEW,
                        "Held for manual review: " + nullSafe(event.getReason()));
                moveSaga(saga, SagaStatus.AWAITING_REVIEW, SagaStep.MANUAL_REVIEW);
                save(tx, saga);
                audit(tx.getId(), "FRAUD_REVIEW", actor, describe(event));
                log.info("Transaction {} held for manual fraud review (alert {})", tx.getReference(), event.getAlertId());
            }
            case BLOCK -> {
                if (!isIn(tx, event, TransactionStatus.PENDING, TransactionStatus.UNDER_REVIEW)) {
                    return;
                }
                tx.setRiskScore(event.getRiskScore());
                String reason = event.getReason() != null ? event.getReason() : ErrorCode.FRAUD_BLOCKED.getMessage();
                audit(tx.getId(), "FRAUD_BLOCKED", actor, describe(event));
                fail(tx, saga, ErrorCode.FRAUD_BLOCKED.name(), "Blocked by fraud check: " + reason);
            }
        }
    }

    // ------------------------------------------------------------------ step 3: balance update result

    /** Handles BALANCE_UPDATED from account-service: the money moved, finish the saga. */
    @Transactional
    public void handleBalanceUpdated(BalanceUpdatedEvent event) {
        if (!markProcessed(event)) {
            return;
        }
        Optional<SagaContext> context = load(event.getTransactionId(), event);
        if (context.isEmpty()) {
            return;
        }
        Transaction tx = context.get().transaction();
        SagaState saga = context.get().saga();

        if (tx.getStatus() == TransactionStatus.FAILED) {
            // Can only happen if the timeout job failed the saga while account-service was still working.
            // account-service did move the money, so someone must reconcile this by hand.
            log.error("RECONCILIATION NEEDED: balance updated for transaction {} which is already FAILED ({})",
                    tx.getReference(), tx.getFailureReason());
            audit(tx.getId(), "BALANCE_UPDATED_AFTER_FAILURE", ACCOUNT_SERVICE,
                    "Balance was updated after the transaction failed - manual reconciliation required");
            return;
        }
        if (!isIn(tx, event, TransactionStatus.PROCESSING)) {
            return;
        }
        Instant now = Instant.now();
        tx.setCompletedAt(now);
        changeStatus(tx, TransactionStatus.COMPLETED, "Balances updated");
        moveSaga(saga, SagaStatus.COMPLETED, SagaStep.COMPLETION);
        saga.setCompletedAt(now);
        save(tx, saga);
        audit(tx.getId(), "COMPLETED", ACCOUNT_SERVICE, "sourceBalanceAfter=" + event.getSourceBalanceAfter()
                + ", destinationBalanceAfter=" + event.getDestinationBalanceAfter());
        eventProducer.publish(new TransactionCompletedEvent(tx));
        log.info("Transaction {} completed", tx.getReference());
    }

    /**
     * Handles BALANCE_UPDATE_FAILED from account-service. Nothing to compensate: account-service
     * changes nothing when it fails (debit + credit are one DB transaction there).
     */
    @Transactional
    public void handleBalanceUpdateFailed(BalanceUpdateFailedEvent event) {
        if (!markProcessed(event)) {
            return;
        }
        Optional<SagaContext> context = load(event.getTransactionId(), event);
        if (context.isEmpty()) {
            return;
        }
        Transaction tx = context.get().transaction();
        if (!isIn(tx, event, TransactionStatus.PROCESSING)) {
            return;
        }
        String code = event.getErrorCode() != null ? event.getErrorCode() : ErrorCode.TRANSACTION_FAILED.name();
        String reason = event.getReason() != null ? event.getReason() : "Balance update failed";
        audit(tx.getId(), "BALANCE_UPDATE_FAILED", ACCOUNT_SERVICE, code + ": " + reason);
        fail(tx, context.get().saga(), code, reason);
    }

    // ------------------------------------------------------------------ timeout job

    /**
     * Fails sagas stuck in AWAITING_FRAUD_CHECK / AWAITING_BALANCE_UPDATE for longer than
     * {@code saga.timeout-minutes}. Runs every {@code saga.timeout-check-interval-ms} (default 1 min).
     */
    @Scheduled(fixedDelayString = "${saga.timeout-check-interval-ms:60000}",
            initialDelayString = "${saga.timeout-check-interval-ms:60000}")
    @Transactional
    public void timeOutStuckSagas() {
        Instant cutoff = Instant.now().minus(Duration.ofMinutes(timeoutMinutes));
        List<SagaState> stuck = sagaStateRepository.findByStatusInAndUpdatedAtBefore(TIMEOUT_STATUSES, cutoff);
        for (SagaState saga : stuck) {
            Optional<Transaction> found = transactionRepository.findById(saga.getTransactionId());
            if (found.isEmpty()) {
                log.warn("Saga {} points to missing transaction {}, skipping", saga.getId(), saga.getTransactionId());
                continue;
            }
            Transaction tx = found.get();
            if (tx.getStatus().isTerminal()) {
                log.warn("Saga {} is {} but transaction {} is already {}, skipping",
                        saga.getId(), saga.getStatus(), tx.getReference(), tx.getStatus());
                continue;
            }
            log.warn("Saga for transaction {} timed out in step {}", tx.getReference(), saga.getCurrentStep());
            audit(tx.getId(), "TIMED_OUT", TIMEOUT_ACTOR,
                    "No response within " + timeoutMinutes + " minutes in step " + saga.getCurrentStep());
            fail(tx, saga, ErrorCode.TRANSACTION_FAILED.name(), SAGA_TIMEOUT_REASON);
        }
        if (!stuck.isEmpty()) {
            log.info("Saga timeout job processed {} stuck saga(s)", stuck.size());
        }
    }

    // ------------------------------------------------------------------ helpers

    /** The transaction and its saga, loaded together. */
    private record SagaContext(Transaction transaction, SagaState saga) {
    }

    private void fail(Transaction tx, SagaState saga, String failureCode, String reason) {
        String trimmed = truncate(reason);
        tx.setFailureCode(failureCode);
        tx.setFailureReason(trimmed);
        changeStatus(tx, TransactionStatus.FAILED, trimmed);
        // keep currentStep as-is so the admin can see WHERE the saga failed
        saga.setStatus(SagaStatus.FAILED);
        saga.setFailureReason(trimmed);
        saga.setCompletedAt(Instant.now());
        save(tx, saga);
        eventProducer.publish(new TransactionFailedEvent(tx));
        log.info("Transaction {} failed: {} ({})", tx.getReference(), trimmed, failureCode);
    }

    private void changeStatus(Transaction tx, TransactionStatus to, String reason) {
        TransactionStatus from = tx.getStatus();
        tx.setStatus(to);
        recordHistory(tx.getId(), from, to, reason);
    }

    private void recordHistory(UUID transactionId, TransactionStatus from, TransactionStatus to, String reason) {
        historyRepository.save(TransactionStatusHistory.builder()
                .transactionId(transactionId)
                .fromStatus(from)
                .toStatus(to)
                .reason(truncate(reason))
                .changedAt(Instant.now())
                .build());
    }

    private void moveSaga(SagaState saga, SagaStatus status, SagaStep step) {
        saga.setStatus(status);
        saga.setCurrentStep(step);
    }

    private void save(Transaction tx, SagaState saga) {
        transactionRepository.save(tx);
        sagaStateRepository.save(saga);
    }

    private void audit(UUID transactionId, String action, String actor, String details) {
        auditRepository.save(TransactionAudit.builder()
                .transactionId(transactionId)
                .action(action)
                .actor(actor != null ? actor : EventSources.TRANSACTION_SERVICE)
                .details(details != null && details.length() > 1000 ? details.substring(0, 1000) : details)
                .createdAt(Instant.now())
                .build());
    }

    /**
     * Records the event as processed.
     *
     * @return false if it was processed before (duplicate delivery) and must be skipped
     */
    private boolean markProcessed(BaseEvent event) {
        String eventId = event.getEventId();
        if (eventId == null) {
            log.warn("{} without eventId - cannot de-duplicate, processing anyway", event.getEventType());
            return true;
        }
        if (processedEventRepository.existsById(eventId)) {
            log.info("Skipping duplicate event {} ({})", eventId, event.getEventType());
            return false;
        }
        processedEventRepository.save(new ProcessedEvent(eventId,
                event.getEventType() != null ? event.getEventType().name() : "UNKNOWN", Instant.now()));
        return true;
    }

    /** Finds the transaction + saga an event refers to; empty (with a warning) if unknown. */
    private Optional<SagaContext> load(String transactionId, BaseEvent event) {
        String rawId = transactionId != null ? transactionId : event.getAggregateId();
        UUID id;
        try {
            id = UUID.fromString(rawId);
        } catch (IllegalArgumentException | NullPointerException e) {
            log.warn("Ignoring {} with invalid transactionId '{}'", event.getEventType(), rawId);
            return Optional.empty();
        }
        Optional<Transaction> tx = transactionRepository.findById(id);
        if (tx.isEmpty()) {
            log.warn("Ignoring {} for unknown transaction {}", event.getEventType(), id);
            return Optional.empty();
        }
        Optional<SagaState> saga = sagaStateRepository.findByTransactionId(id);
        if (saga.isEmpty()) {
            log.warn("Ignoring {} for transaction {}: no saga state found", event.getEventType(), id);
            return Optional.empty();
        }
        return Optional.of(new SagaContext(tx.get(), saga.get()));
    }

    /** True if the transaction is in one of the expected states; otherwise logs and returns false. */
    private boolean isIn(Transaction tx, BaseEvent event, TransactionStatus... expected) {
        for (TransactionStatus status : expected) {
            if (tx.getStatus() == status) {
                return true;
            }
        }
        log.warn("Ignoring {} for transaction {}: status is {}, expected one of {}",
                event.getEventType(), tx.getReference(), tx.getStatus(), List.of(expected));
        return false;
    }

    private static String describe(FraudDecisionReceivedEvent event) {
        return "decision=" + event.getDecision() + ", riskScore=" + event.getRiskScore()
                + ", riskLevel=" + event.getRiskLevel() + ", rules=" + event.getTriggeredRules()
                + ", alertId=" + event.getAlertId() + ", reason=" + event.getReason();
    }

    private static String nullSafe(String value) {
        return value != null ? value : "no reason given";
    }

    private static String truncate(String value) {
        return value != null && value.length() > MAX_TEXT_LENGTH ? value.substring(0, MAX_TEXT_LENGTH) : value;
    }
}

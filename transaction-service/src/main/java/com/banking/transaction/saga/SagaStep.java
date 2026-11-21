package com.banking.transaction.saga;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * The steps of the transaction saga, in order. {@code SagaState.currentStep} records
 * which step the saga is at (or ended at).
 * <ol>
 *   <li>FRAUD_CHECK - fraud-service scores the transaction</li>
 *   <li>MANUAL_REVIEW - only if fraud said REVIEW: an admin decides</li>
 *   <li>BALANCE_UPDATE - account-service debits/credits the accounts</li>
 *   <li>COMPLETION - final step, the saga is finished (COMPLETED or FAILED)</li>
 * </ol>
 * There is no compensation step: account-service applies the debit and credit atomically
 * in one DB transaction, so a failure never leaves half-moved money to undo.
 */
@Getter
@RequiredArgsConstructor
public enum SagaStep {
    FRAUD_CHECK("Waiting for fraud-service to score the transaction"),
    MANUAL_REVIEW("Waiting for an admin to review the fraud alert"),
    BALANCE_UPDATE("Waiting for account-service to move the money"),
    COMPLETION("Saga finished");

    private final String description;
}

package com.banking.fraud.exception;

import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;

/**
 * Thrown when no fraud decision exists for a transaction (HTTP 404) - e.g. it was not checked yet.
 */
public class FraudDecisionNotFoundException extends BankingException {

    public FraudDecisionNotFoundException(String transactionId) {
        super(ErrorCode.NOT_FOUND, "No fraud decision for transaction: " + transactionId);
    }
}

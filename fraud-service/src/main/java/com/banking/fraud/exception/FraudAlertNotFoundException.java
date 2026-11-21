package com.banking.fraud.exception;

import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;

/**
 * Thrown when a fraud alert id does not exist (HTTP 404).
 */
public class FraudAlertNotFoundException extends BankingException {

    public FraudAlertNotFoundException(Object alertId) {
        super(ErrorCode.FRAUD_ALERT_NOT_FOUND, "Fraud alert not found: " + alertId);
    }
}

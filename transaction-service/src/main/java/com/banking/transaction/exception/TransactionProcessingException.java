package com.banking.transaction.exception;

import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;

/**
 * Something technical went wrong while processing a transaction
 * (e.g. an event could not be serialized). Maps to TRANSACTION_FAILED.
 */
public class TransactionProcessingException extends BankingException {

    public TransactionProcessingException(String message) {
        super(ErrorCode.TRANSACTION_FAILED, message);
    }

    public TransactionProcessingException(String message, Throwable cause) {
        super(ErrorCode.TRANSACTION_FAILED, message, cause);
    }
}

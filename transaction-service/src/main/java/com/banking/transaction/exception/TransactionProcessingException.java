package com.banking.transaction.exception;

import com.banking.common.exception.BankingException;
import org.springframework.http.HttpStatus;

public class TransactionProcessingException extends BankingException {

    private static final String ERROR_CODE = "TX_PROCESSING_ERROR";

    public TransactionProcessingException(String message) {
        super(message, ERROR_CODE, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    public TransactionProcessingException(String message, Throwable cause) {
        super(message, ERROR_CODE, HttpStatus.UNPROCESSABLE_ENTITY, cause);
    }
}

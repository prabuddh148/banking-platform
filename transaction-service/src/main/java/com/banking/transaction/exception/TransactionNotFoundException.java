package com.banking.transaction.exception;

import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;

/** Thrown when a transaction id / reference does not exist (HTTP 404). */
public class TransactionNotFoundException extends BankingException {

    public TransactionNotFoundException(String idOrReference) {
        super(ErrorCode.TRANSACTION_NOT_FOUND, "Transaction not found: " + idOrReference);
    }
}

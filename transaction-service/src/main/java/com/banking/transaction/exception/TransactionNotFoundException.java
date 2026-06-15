package com.banking.transaction.exception;

import com.banking.common.exception.ResourceNotFoundException;

import java.util.UUID;

public class TransactionNotFoundException extends ResourceNotFoundException {

    public TransactionNotFoundException(UUID transactionId) {
        super("Transaction", transactionId.toString());
    }
}

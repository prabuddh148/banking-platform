package com.banking.account.exception;

import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;

/**
 * Thrown when no account exists for the given id or account number (HTTP 404).
 */
public class AccountNotFoundException extends BankingException {

    public AccountNotFoundException(String identifier) {
        super(ErrorCode.ACCOUNT_NOT_FOUND, "Account not found: " + identifier);
    }
}

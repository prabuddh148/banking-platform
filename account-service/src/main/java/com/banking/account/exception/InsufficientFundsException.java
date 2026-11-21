package com.banking.account.exception;

import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;

import java.math.BigDecimal;

/**
 * Thrown when the available balance is lower than the amount to debit or reserve (HTTP 409).
 */
public class InsufficientFundsException extends BankingException {

    public InsufficientFundsException(String accountNumber, BigDecimal available, BigDecimal requested) {
        super(ErrorCode.INSUFFICIENT_FUNDS,
                "Insufficient funds in account " + accountNumber + ": available " + available
                        + ", requested " + requested);
    }
}

package com.banking.transaction.validation;

import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.banking.transaction.entity.TransactionType;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.Locale;
import java.util.Set;

/**
 * Business validation of a new transaction, on top of the Bean Validation annotations on the
 * request DTOs (which only run for HTTP requests). Throws INVALID_TRANSACTION (400) on problems.
 * <p>
 * Things this service can't check (account exists, is active, belongs to the user, has enough
 * money) are checked by account-service during the balance-update step.
 */
@Component
public class TransactionValidator {

    public static final String DEFAULT_CURRENCY = "INR";
    public static final Set<String> SUPPORTED_CURRENCIES = Set.of("INR", "USD", "EUR", "GBP");
    public static final BigDecimal MAX_AMOUNT = new BigDecimal("10000000.00");

    /** Returns the currency to use: upper-cased, INR when not given. */
    public String resolveCurrency(String currency) {
        if (currency == null || currency.isBlank()) {
            return DEFAULT_CURRENCY;
        }
        String normalized = currency.trim().toUpperCase(Locale.ROOT);
        if (!SUPPORTED_CURRENCIES.contains(normalized)) {
            throw invalid("Unsupported currency: " + currency);
        }
        return normalized;
    }

    public void validate(TransactionType type, String sourceAccountId, String destinationAccountId, BigDecimal amount) {
        if (type == null) {
            throw invalid("Transaction type is required");
        }
        validateAmount(amount);
        switch (type) {
            case DEPOSIT -> require(destinationAccountId, "Deposit needs an account");
            case WITHDRAWAL -> require(sourceAccountId, "Withdrawal needs an account");
            case TRANSFER -> {
                require(sourceAccountId, "Transfer needs a source account");
                require(destinationAccountId, "Transfer needs a destination account");
                if (sourceAccountId.equals(destinationAccountId)) {
                    throw invalid("Source and destination accounts must be different");
                }
            }
        }
    }

    private void validateAmount(BigDecimal amount) {
        if (amount == null || amount.signum() <= 0) {
            throw invalid("Amount must be greater than 0");
        }
        if (amount.compareTo(MAX_AMOUNT) > 0) {
            throw invalid("Amount must not exceed 10,000,000");
        }
        if (amount.stripTrailingZeros().scale() > 2) {
            throw invalid("Amount can have at most 2 decimal places");
        }
    }

    private static void require(String value, String message) {
        if (value == null || value.isBlank()) {
            throw invalid(message);
        }
    }

    private static BankingException invalid(String message) {
        return new BankingException(ErrorCode.INVALID_TRANSACTION, message);
    }
}

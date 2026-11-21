package com.banking.common.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

import java.util.Set;

/**
 * Checks that a currency code is one the platform supports.
 */
public class CurrencyValidator implements ConstraintValidator<ValidCurrency, String> {

    public static final Set<String> SUPPORTED_CURRENCIES = Set.of("INR", "USD", "EUR", "GBP");

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return value == null || isSupported(value);
    }

    public static boolean isSupported(String currency) {
        return currency != null && SUPPORTED_CURRENCIES.contains(currency.toUpperCase());
    }
}

package com.banking.common.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

import java.math.BigInteger;

/**
 * IBAN check using the standard mod-97 algorithm.
 */
public class IbanValidator implements ConstraintValidator<ValidIban, String> {

    private static final BigInteger NINETY_SEVEN = BigInteger.valueOf(97);

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return value == null || isValidIban(value);
    }

    public static boolean isValidIban(String iban) {
        if (iban == null) {
            return false;
        }
        String clean = iban.replaceAll("\\s", "").toUpperCase();
        if (clean.length() < 15 || clean.length() > 34 || !clean.matches("[A-Z]{2}\\d{2}[A-Z0-9]+")) {
            return false;
        }
        // Move the first 4 characters to the end, then turn letters into numbers (A=10 ... Z=35).
        String rearranged = clean.substring(4) + clean.substring(0, 4);
        StringBuilder numeric = new StringBuilder();
        for (char c : rearranged.toCharArray()) {
            numeric.append(Character.getNumericValue(c));
        }
        return new BigInteger(numeric.toString()).mod(NINETY_SEVEN).intValue() == 1;
    }
}

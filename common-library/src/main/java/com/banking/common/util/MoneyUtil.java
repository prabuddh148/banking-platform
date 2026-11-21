package com.banking.common.util;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.NumberFormat;
import java.util.Currency;
import java.util.Locale;

/**
 * Money helpers. Always use BigDecimal for money, never double.
 */
public final class MoneyUtil {

    public static final int SCALE = 2;
    public static final RoundingMode ROUNDING = RoundingMode.HALF_EVEN;
    public static final BigDecimal ZERO = BigDecimal.ZERO.setScale(SCALE, ROUNDING);
    public static final String DEFAULT_CURRENCY = "INR";

    private MoneyUtil() {
    }

    /** Rounds to 2 decimal places; null becomes 0.00. */
    public static BigDecimal normalize(BigDecimal amount) {
        return amount == null ? ZERO : amount.setScale(SCALE, ROUNDING);
    }

    public static BigDecimal add(BigDecimal a, BigDecimal b) {
        return normalize(normalize(a).add(normalize(b)));
    }

    public static BigDecimal subtract(BigDecimal a, BigDecimal b) {
        return normalize(normalize(a).subtract(normalize(b)));
    }

    public static boolean isPositive(BigDecimal amount) {
        return amount != null && amount.signum() > 0;
    }

    public static boolean isNegative(BigDecimal amount) {
        return amount != null && amount.signum() < 0;
    }

    /** true when {@code balance >= amount}. */
    public static boolean hasSufficientFunds(BigDecimal balance, BigDecimal amount) {
        return normalize(balance).compareTo(normalize(amount)) >= 0;
    }

    /** 5000 INR -> "₹5,000.00" */
    public static String format(BigDecimal amount, String currencyCode) {
        String code = currencyCode == null ? DEFAULT_CURRENCY : currencyCode;
        Locale locale = "INR".equals(code) ? Locale.forLanguageTag("en-IN") : Locale.US;
        NumberFormat format = NumberFormat.getCurrencyInstance(locale);
        format.setCurrency(Currency.getInstance(code));
        return format.format(normalize(amount));
    }
}

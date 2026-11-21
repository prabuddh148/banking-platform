package com.banking.common.util;

/**
 * Hides sensitive values before they go into logs, audit records or notifications.
 */
public final class MaskingUtil {

    private static final char MASK = '*';

    private MaskingUtil() {
    }

    /** ACC1234567890 -> *********7890 (keeps the last 4 characters). */
    public static String maskAccountNumber(String accountNumber) {
        return keepLast(accountNumber, 4);
    }

    /** rahul.sharma@example.com -> r***********@example.com */
    public static String maskEmail(String email) {
        if (email == null || email.isBlank()) {
            return email;
        }
        int at = email.indexOf('@');
        if (at <= 1) {
            return MASK + email.substring(Math.max(at, 0));
        }
        return email.charAt(0) + repeat(at - 1) + email.substring(at);
    }

    /** +919876543210 -> *********3210 */
    public static String maskPhone(String phone) {
        return keepLast(phone, 4);
    }

    /** 4111 1111 1111 1111 -> ************1111 */
    public static String maskCardNumber(String cardNumber) {
        return keepLast(cardNumber == null ? null : cardNumber.replaceAll("\\s", ""), 4);
    }

    /** Masks everything except the last {@code visible} characters. */
    public static String keepLast(String value, int visible) {
        if (value == null || value.isEmpty()) {
            return value;
        }
        if (value.length() <= visible) {
            return repeat(value.length());
        }
        return repeat(value.length() - visible) + value.substring(value.length() - visible);
    }

    private static String repeat(int count) {
        return String.valueOf(MASK).repeat(Math.max(count, 0));
    }
}

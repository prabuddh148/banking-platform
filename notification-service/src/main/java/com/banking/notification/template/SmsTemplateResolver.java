package com.banking.notification.template;

import org.springframework.stereotype.Component;

import java.util.Map;

import static com.banking.notification.template.NotificationTemplate.Vars;

/**
 * Builds the short plain-text version of a message.
 * <p>
 * It is used as the SMS / push text and as the plain-text part of emails, so every
 * notification row has a readable {@code message}. SMS texts are kept within 160 characters.
 * Values passed in must already be formatted (amount via MoneyUtil, account number masked).
 */
@Component
public class SmsTemplateResolver {

    public static final int MAX_SMS_LENGTH = 160;
    private static final String BANK = "Meridian Bank";

    public String build(NotificationTemplate template, Map<String, Object> vars) {
        String text = switch (template) {
            case WELCOME -> "Welcome to %s, %s! Your %s account %s is now open."
                    .formatted(BANK, get(vars, Vars.CUSTOMER_NAME), get(vars, Vars.ACCOUNT_TYPE).toLowerCase(),
                            get(vars, Vars.ACCOUNT_NUMBER));
            case ACCOUNT_STATUS_CHANGED -> "%s: your account %s is now %s.%s"
                    .formatted(BANK, get(vars, Vars.ACCOUNT_NUMBER), get(vars, Vars.NEW_STATUS),
                            optional(" Reason: ", get(vars, Vars.REASON)));
            case TRANSACTION_COMPLETED -> "%s: %s of %s on a/c %s was successful. Ref %s."
                    .formatted(BANK, label(get(vars, Vars.TRANSACTION_TYPE)), get(vars, Vars.AMOUNT),
                            get(vars, Vars.ACCOUNT_NUMBER), get(vars, Vars.REFERENCE));
            case TRANSACTION_FAILED -> "%s: %s of %s on a/c %s failed.%s Ref %s."
                    .formatted(BANK, label(get(vars, Vars.TRANSACTION_TYPE)), get(vars, Vars.AMOUNT),
                            get(vars, Vars.ACCOUNT_NUMBER), optional(" Reason: ", get(vars, Vars.FAILURE_REASON)),
                            get(vars, Vars.REFERENCE));
            case MONEY_RECEIVED -> "%s: %s credited to a/c %s from a/c %s. Ref %s."
                    .formatted(BANK, get(vars, Vars.AMOUNT), get(vars, Vars.ACCOUNT_NUMBER),
                            get(vars, Vars.COUNTERPARTY_ACCOUNT), get(vars, Vars.REFERENCE));
            case GENERIC -> get(vars, Vars.MESSAGE);
        };
        return shorten(text);
    }

    /** "TRANSFER" -> "Transfer" */
    private static String label(String transactionType) {
        if (transactionType.isEmpty()) {
            return "Transaction";
        }
        return transactionType.charAt(0) + transactionType.substring(1).toLowerCase();
    }

    private static String optional(String prefix, String value) {
        return value.isBlank() ? "" : prefix + value + ".";
    }

    private static String get(Map<String, Object> vars, String key) {
        Object value = vars.get(key);
        return value == null ? "" : value.toString();
    }

    private static String shorten(String text) {
        return text.length() <= MAX_SMS_LENGTH ? text : text.substring(0, MAX_SMS_LENGTH - 3) + "...";
    }
}

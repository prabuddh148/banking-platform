package com.banking.notification.template;

import com.banking.notification.entity.NotificationType;
import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * The message templates this service knows.
 * <p>
 * Each template has a {@link NotificationType}, the Thymeleaf HTML file used for emails
 * (under {@code src/main/resources/templates/}) and a default subject line.
 * The short SMS / plain-text version is built by {@link SmsTemplateResolver}.
 */
@Getter
@RequiredArgsConstructor
public enum NotificationTemplate {

    WELCOME(NotificationType.WELCOME, "email/welcome",
            "Welcome to Meridian Bank"),
    ACCOUNT_STATUS_CHANGED(NotificationType.ACCOUNT_STATUS_CHANGED, "email/account-status-changed",
            "Your account status has changed"),
    TRANSACTION_COMPLETED(NotificationType.TRANSACTION_COMPLETED, "email/transaction-completed",
            "Your transaction was successful"),
    TRANSACTION_FAILED(NotificationType.TRANSACTION_FAILED, "email/transaction-failed",
            "Your transaction could not be completed"),
    MONEY_RECEIVED(NotificationType.MONEY_RECEIVED, "email/money-received",
            "You have received money"),
    GENERIC(NotificationType.GENERAL, "email/generic",
            "A message from Meridian Bank");

    /** Keys of the variables the templates use (so callers and templates agree on names). */
    public static final class Vars {
        public static final String CUSTOMER_NAME = "customerName";
        public static final String ACCOUNT_NUMBER = "accountNumber";
        public static final String ACCOUNT_TYPE = "accountType";
        public static final String CURRENCY = "currency";
        public static final String AMOUNT = "amount";
        public static final String BALANCE = "balance";
        public static final String REFERENCE = "reference";
        public static final String TRANSACTION_TYPE = "transactionType";
        public static final String DESCRIPTION = "description";
        public static final String COUNTERPARTY_ACCOUNT = "counterpartyAccount";
        public static final String FAILURE_REASON = "failureReason";
        public static final String PREVIOUS_STATUS = "previousStatus";
        public static final String NEW_STATUS = "newStatus";
        public static final String REASON = "reason";
        public static final String DATE = "date";
        public static final String SUBJECT = "subject";
        public static final String MESSAGE = "message";

        private Vars() {
        }
    }

    private final NotificationType type;
    /** Thymeleaf template name, e.g. "email/welcome" -> templates/email/welcome.html */
    private final String emailTemplate;
    private final String defaultSubject;
}

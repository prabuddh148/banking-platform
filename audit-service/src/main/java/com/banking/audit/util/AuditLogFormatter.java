package com.banking.audit.util;

import com.banking.audit.entity.AuditEventType;
import com.banking.common.util.MaskingUtil;
import com.banking.common.util.MoneyUtil;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.Set;

/**
 * Turns a raw Kafka event (as a JSON tree) into the two text columns of an audit log:
 * <ul>
 *   <li>{@link #buildAction} - one human readable sentence, e.g.
 *       "TRANSFER TXN20240101ABCD1234 of 500.00 INR completed".</li>
 *   <li>{@link #buildDetails} - the event payload as JSON, without the common envelope fields and with
 *       personal data masked (emails, phone numbers, account numbers) using {@link MaskingUtil}.</li>
 * </ul>
 */
@Component
@RequiredArgsConstructor
public class AuditLogFormatter {

    /** BaseEvent fields - they already have their own columns, so they are left out of {@code details}. */
    private static final Set<String> ENVELOPE_FIELDS = Set.of(
            "eventId", "eventType", "aggregateId", "occurredAt", "correlationId", "source", "schemaVersion");

    private static final int MAX_ACTION_LENGTH = 500;
    private static final String MISSING = "n/a";

    private final ObjectMapper objectMapper;

    // ------------------------------------------------------------------ action text

    public String buildAction(AuditEventType type, JsonNode event) {
        String action = switch (type) {
            case ACCOUNT_CREATED -> String.format("Account %s (%s, %s) opened for customer %s with initial balance %s %s",
                    maskedAccountNumber(event), text(event, "accountType"), text(event, "currency"),
                    text(event, "customerId"), amount(event, "initialBalance"), text(event, "currency"));
            case ACCOUNT_STATUS_CHANGED -> String.format("Account %s status changed from %s to %s%s",
                    maskedAccountNumber(event), text(event, "previousStatus"), text(event, "newStatus"),
                    suffix(": ", event, "reason"));
            case BALANCE_UPDATED -> String.format("Balances updated for %s transaction %s: %s %s",
                    text(event, "transactionType"), text(event, "transactionId"),
                    amount(event, "amount"), text(event, "currency"));
            case BALANCE_UPDATE_FAILED -> String.format("Balance update failed for transaction %s: %s (%s)",
                    text(event, "transactionId"), text(event, "reason"), text(event, "errorCode"));
            case TRANSACTION_INITIATED -> String.format("%s %s of %s %s initiated",
                    text(event, "transactionType"), reference(event), amount(event, "amount"), text(event, "currency"));
            case BALANCE_UPDATE_REQUESTED -> String.format("Balance update requested for %s %s of %s %s",
                    text(event, "transactionType"), reference(event), amount(event, "amount"), text(event, "currency"));
            case TRANSACTION_COMPLETED -> String.format("%s %s of %s %s completed",
                    text(event, "transactionType"), reference(event), amount(event, "amount"), text(event, "currency"));
            case TRANSACTION_FAILED -> String.format("%s %s of %s %s failed: %s (%s)",
                    text(event, "transactionType"), reference(event), amount(event, "amount"), text(event, "currency"),
                    text(event, "failureReason"), text(event, "failureCode"));
            case FRAUD_DETECTED -> String.format("Fraud check flagged transaction %s: decision %s, risk %s (%s/100)%s",
                    text(event, "transactionId"), text(event, "decision"), text(event, "riskLevel"),
                    text(event, "riskScore"), suffix(", reviewed by ", event, "reviewedBy"));
            case FRAUD_CLEARED -> String.format("Transaction %s cleared by fraud check: risk %s (%s/100)%s",
                    text(event, "transactionId"), text(event, "riskLevel"), text(event, "riskScore"),
                    suffix(", reviewed by ", event, "reviewedBy"));
            case NOTIFICATION_REQUESTED -> String.format("%s notification %s requested for recipient %s",
                    text(event, "channel"), text(event, "notificationType"), text(event, "recipientId"));
            case UNKNOWN -> String.format("Unrecognised event '%s' for aggregate %s",
                    text(event, "eventType"), text(event, "aggregateId"));
        };
        return action.length() > MAX_ACTION_LENGTH ? action.substring(0, MAX_ACTION_LENGTH) : action;
    }

    // ------------------------------------------------------------------ details JSON

    /** Payload fields of the event as a JSON string, with PII masked. */
    public String buildDetails(JsonNode event) {
        ObjectNode details = objectMapper.createObjectNode();
        if (event != null && event.isObject()) {
            event.fields().forEachRemaining(field -> {
                if (!ENVELOPE_FIELDS.contains(field.getKey())) {
                    details.set(field.getKey(), mask(field.getKey(), field.getValue()));
                }
            });
        }
        try {
            return objectMapper.writeValueAsString(details);
        } catch (JsonProcessingException e) {
            // Cannot really happen for an ObjectNode, but never lose the audit record because of it.
            return "{}";
        }
    }

    /** Recursively masks values whose field name says they hold personal data. */
    private JsonNode mask(String fieldName, JsonNode value) {
        if (value == null || value.isNull()) {
            return value;
        }
        if (value.isObject()) {
            ObjectNode copy = objectMapper.createObjectNode();
            value.fields().forEachRemaining(f -> copy.set(f.getKey(), mask(f.getKey(), f.getValue())));
            return copy;
        }
        if (value.isArray()) {
            ArrayNode copy = objectMapper.createArrayNode();
            value.forEach(item -> copy.add(mask(fieldName, item)));
            return copy;
        }
        if (value.isValueNode()) {
            String masked = maskValue(fieldName, value.asText());
            return masked == null ? value : TextNode.valueOf(masked);
        }
        return value;
    }

    /** Returns the masked text, or null when the field is not sensitive. */
    private static String maskValue(String fieldName, String text) {
        String name = fieldName == null ? "" : fieldName.toLowerCase(Locale.ROOT);
        if (name.contains("email")) {
            return MaskingUtil.maskEmail(text);
        }
        if (name.contains("phone")) {
            return MaskingUtil.maskPhone(text);
        }
        if (name.contains("accountnumber")) {
            return MaskingUtil.maskAccountNumber(text);
        }
        return null;
    }

    // ------------------------------------------------------------------ helpers

    private static String text(JsonNode event, String field) {
        JsonNode value = event == null ? null : event.get(field);
        if (value == null || value.isNull() || value.asText().isBlank()) {
            return MISSING;
        }
        return value.asText();
    }

    /** Returns prefix + value when the field is present, otherwise an empty string. */
    private static String suffix(String prefix, JsonNode event, String field) {
        String value = text(event, field);
        return MISSING.equals(value) ? "" : prefix + value;
    }

    /** Money amounts are shown with 2 decimals (500 -> "500.00"). */
    private static String amount(JsonNode event, String field) {
        JsonNode value = event == null ? null : event.get(field);
        if (value != null && value.isNumber()) {
            return MoneyUtil.normalize(value.decimalValue()).toPlainString();
        }
        return text(event, field);
    }

    private static String reference(JsonNode event) {
        String reference = text(event, "reference");
        return MISSING.equals(reference) ? text(event, "transactionId") : reference;
    }

    private static String maskedAccountNumber(JsonNode event) {
        String accountNumber = text(event, "accountNumber");
        return MISSING.equals(accountNumber) ? text(event, "accountId") : MaskingUtil.maskAccountNumber(accountNumber);
    }
}

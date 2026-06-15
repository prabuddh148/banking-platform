package com.banking.transaction.validation;

import com.banking.common.exception.ValidationException;
import com.banking.transaction.dto.request.TransferRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.Set;

@Component
@Slf4j
public class TransactionValidator {

    private static final Set<String> SUPPORTED_CURRENCIES = Set.of(
            "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "CNY", "INR", "SGD",
            "HKD", "NOK", "SEK", "DKK", "NZD", "MXN", "BRL", "ZAR", "KRW", "THB"
    );

    public void validateTransferRequest(TransferRequest request) {
        log.debug("Validating transfer request from={} to={}", request.getSourceAccountId(), request.getTargetAccountId());

        if (request.getSourceAccountId() == null) {
            throw new ValidationException("Source account ID is required");
        }

        if (request.getTargetAccountId() == null) {
            throw new ValidationException("Target account ID is required");
        }

        if (request.getSourceAccountId().equals(request.getTargetAccountId())) {
            throw new ValidationException("Source and target accounts must be different");
        }

        if (request.getAmount() == null || request.getAmount().compareTo(BigDecimal.ZERO) <= 0) {
            throw new ValidationException("Amount must be greater than zero");
        }

        if (request.getCurrency() == null || request.getCurrency().isBlank()) {
            throw new ValidationException("Currency is required");
        }

        String currency = request.getCurrency().toUpperCase().trim();
        if (!SUPPORTED_CURRENCIES.contains(currency)) {
            throw new ValidationException("Unsupported currency: " + currency +
                    ". Supported currencies: " + SUPPORTED_CURRENCIES);
        }

        log.debug("Transfer request validation passed");
    }
}

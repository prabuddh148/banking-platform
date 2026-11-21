package com.banking.fraud.rules;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Everything the fraud rules need to know about a transaction, independent of where it came from
 * (a Kafka event or a dry-run REST request).
 *
 * @param transactionId   id of the transaction (may be null for a dry run)
 * @param accountId       account the risk is tracked for (source account, or destination for deposits)
 * @param amount          transaction amount
 * @param currency        ISO currency code
 * @param transactionType DEPOSIT / WITHDRAWAL / TRANSFER
 * @param clientCountry   ISO country of the client, may be null
 * @param occurredAt      when the transaction was initiated
 */
public record TransactionContext(String transactionId,
                                 String accountId,
                                 BigDecimal amount,
                                 String currency,
                                 String transactionType,
                                 String clientCountry,
                                 Instant occurredAt) {

    public TransactionContext {
        if (amount == null) {
            throw new IllegalArgumentException("amount is required for a fraud check");
        }
        if (occurredAt == null) {
            occurredAt = Instant.now();
        }
    }
}

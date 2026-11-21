package com.banking.fraud.rules;

import com.banking.fraud.config.FraudRulesConfig;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Locale;

/**
 * Transactions from unexpected countries are risky. If the client country is known and not in
 * {@code allowedCountries} (default [IN]), adds 25 points. Unknown country = no opinion.
 */
@Component
@RequiredArgsConstructor
public class GeographicRule implements FraudRule {

    public static final String NAME = "GEOGRAPHIC";

    private final FraudRulesConfig config;

    @Override
    public String name() {
        return NAME;
    }

    @Override
    public RuleResult evaluate(TransactionContext context) {
        FraudRulesConfig.Geographic cfg = config.getGeographic();
        String country = context.clientCountry();
        if (!cfg.isEnabled() || country == null || country.isBlank()) {
            return RuleResult.notTriggered(NAME);
        }
        String normalized = country.trim().toUpperCase(Locale.ROOT);
        boolean allowed = cfg.getAllowedCountries().stream()
                .anyMatch(c -> c.trim().equalsIgnoreCase(normalized));
        if (!allowed) {
            return RuleResult.triggered(NAME, cfg.getScore(),
                    "Transaction from non-allowed country " + normalized);
        }
        return RuleResult.notTriggered(NAME);
    }
}

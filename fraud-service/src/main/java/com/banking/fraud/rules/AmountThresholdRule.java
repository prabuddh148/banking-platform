package com.banking.fraud.rules;

import com.banking.fraud.config.FraudRulesConfig;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Large transactions are risky. Above {@code highAmount} (default 100,000) adds 40 points,
 * above {@code veryHighAmount} (default 500,000) adds 70 points instead.
 */
@Component
@RequiredArgsConstructor
public class AmountThresholdRule implements FraudRule {

    public static final String NAME = "AMOUNT_THRESHOLD";

    private final FraudRulesConfig config;

    @Override
    public String name() {
        return NAME;
    }

    @Override
    public RuleResult evaluate(TransactionContext context) {
        FraudRulesConfig.AmountThreshold cfg = config.getAmountThreshold();
        if (!cfg.isEnabled()) {
            return RuleResult.notTriggered(NAME);
        }
        if (context.amount().compareTo(cfg.getVeryHighAmount()) > 0) {
            return RuleResult.triggered(NAME, cfg.getVeryHighScore(),
                    "Amount " + context.amount().toPlainString() + " exceeds " + cfg.getVeryHighAmount().toPlainString());
        }
        if (context.amount().compareTo(cfg.getHighAmount()) > 0) {
            return RuleResult.triggered(NAME, cfg.getHighScore(),
                    "Amount " + context.amount().toPlainString() + " exceeds " + cfg.getHighAmount().toPlainString());
        }
        return RuleResult.notTriggered(NAME);
    }
}

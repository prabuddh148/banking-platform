package com.banking.fraud.rules;

import com.banking.fraud.config.FraudRulesConfig;
import com.banking.fraud.repository.FraudDecisionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;

/**
 * Many transactions on the same account in a short time is a classic fraud signal.
 * Counts the decisions stored for the account in the last {@code windowMinutes} (default 10);
 * if that count plus the current transaction is more than {@code maxTransactions} (default 5), adds 30 points.
 */
@Component
@RequiredArgsConstructor
public class VelocityRule implements FraudRule {

    public static final String NAME = "VELOCITY";

    private final FraudRulesConfig config;
    private final FraudDecisionRepository decisionRepository;

    @Override
    public String name() {
        return NAME;
    }

    @Override
    public RuleResult evaluate(TransactionContext context) {
        FraudRulesConfig.Velocity cfg = config.getVelocity();
        if (!cfg.isEnabled() || context.accountId() == null) {
            return RuleResult.notTriggered(NAME);
        }
        Instant since = context.occurredAt().minus(Duration.ofMinutes(cfg.getWindowMinutes()));
        long previous = decisionRepository.countByAccountIdAndEvaluatedAtAfter(context.accountId(), since);
        long total = previous + 1; // + the transaction being checked right now
        if (total > cfg.getMaxTransactions()) {
            return RuleResult.triggered(NAME, cfg.getScore(),
                    total + " transactions on account in the last " + cfg.getWindowMinutes()
                            + " minutes (limit " + cfg.getMaxTransactions() + ")");
        }
        return RuleResult.notTriggered(NAME);
    }
}

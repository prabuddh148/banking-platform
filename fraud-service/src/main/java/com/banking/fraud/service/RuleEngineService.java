package com.banking.fraud.service;

import com.banking.fraud.rules.FraudRule;
import com.banking.fraud.rules.RuleResult;
import com.banking.fraud.rules.TransactionContext;
import com.banking.fraud.util.RiskScoreCalculator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Runs every {@link FraudRule} bean (Spring injects all of them as a List) and combines the
 * results into a {@link FraudEvaluation}. A rule that throws is logged and skipped, so one broken
 * rule cannot stop all fraud checks.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RuleEngineService {

    static final String NO_RULES_REASON = "No fraud rules triggered";

    private final List<FraudRule> rules;
    private final RiskScoreCalculator calculator;

    public FraudEvaluation evaluate(TransactionContext context) {
        List<RuleResult> results = new ArrayList<>();
        for (FraudRule rule : rules) {
            try {
                RuleResult result = rule.evaluate(context);
                results.add(result);
                if (result.triggered()) {
                    log.debug("Rule {} triggered for transaction {} (+{}): {}",
                            rule.name(), context.transactionId(), result.score(), result.reason());
                }
            } catch (RuntimeException ex) {
                log.error("Fraud rule {} failed for transaction {}, skipping it", rule.name(), context.transactionId(), ex);
            }
        }

        List<RuleResult> triggered = results.stream().filter(RuleResult::triggered).toList();
        int score = calculator.totalScore(results);
        var level = calculator.riskLevel(score);
        var decision = calculator.decision(level);
        List<String> names = triggered.stream().map(RuleResult::name).toList();
        String reason = triggered.isEmpty()
                ? NO_RULES_REASON
                : String.join("; ", triggered.stream().map(RuleResult::reason).toList());

        return new FraudEvaluation(score, level, decision, names, reason, results);
    }
}

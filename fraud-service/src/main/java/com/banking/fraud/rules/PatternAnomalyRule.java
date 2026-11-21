package com.banking.fraud.rules;

import com.banking.fraud.config.FraudRulesConfig;
import com.banking.fraud.entity.FraudDecision;
import com.banking.fraud.repository.FraudDecisionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

/**
 * Behaviour that does not fit the account's usual pattern:
 * <ul>
 *   <li>amount more than {@code multiplier} (default 5x) the average of the last {@code historySize}
 *       (default 20) transactions, when there are at least {@code minHistory} (default 3) of them: +20</li>
 *   <li>transaction at night, between {@code nightStartHour} and {@code nightEndHour} (default 00:00-05:00 IST): +10</li>
 * </ul>
 * Both can fire together (+30).
 */
@Component
@RequiredArgsConstructor
public class PatternAnomalyRule implements FraudRule {

    public static final String NAME = "PATTERN_ANOMALY";

    private final FraudRulesConfig config;
    private final FraudDecisionRepository decisionRepository;

    @Override
    public String name() {
        return NAME;
    }

    @Override
    public RuleResult evaluate(TransactionContext context) {
        FraudRulesConfig.PatternAnomaly cfg = config.getPatternAnomaly();
        if (!cfg.isEnabled()) {
            return RuleResult.notTriggered(NAME);
        }
        int score = 0;
        List<String> reasons = new ArrayList<>();

        if (context.accountId() != null) {
            List<FraudDecision> history = decisionRepository.findByAccountIdOrderByEvaluatedAtDesc(
                    context.accountId(), PageRequest.of(0, cfg.getHistorySize()));
            if (history.size() >= cfg.getMinHistory()) {
                BigDecimal total = history.stream().map(FraudDecision::getAmount)
                        .reduce(BigDecimal.ZERO, BigDecimal::add);
                BigDecimal average = total.divide(BigDecimal.valueOf(history.size()), 2, RoundingMode.HALF_EVEN);
                BigDecimal limit = average.multiply(cfg.getMultiplier());
                if (context.amount().compareTo(limit) > 0) {
                    score += cfg.getAmountAnomalyScore();
                    reasons.add("Amount " + context.amount().toPlainString() + " is more than "
                            + cfg.getMultiplier().toPlainString() + "x the account average " + average.toPlainString());
                }
            }
        }

        int hour = context.occurredAt().atZone(ZoneId.of(cfg.getTimeZone())).getHour();
        if (hour >= cfg.getNightStartHour() && hour < cfg.getNightEndHour()) {
            score += cfg.getNightScore();
            reasons.add(String.format("Transaction at unusual hour (%02d:00 %s)", hour, cfg.getTimeZone()));
        }

        return score > 0
                ? RuleResult.triggered(NAME, score, String.join("; ", reasons))
                : RuleResult.notTriggered(NAME);
    }
}

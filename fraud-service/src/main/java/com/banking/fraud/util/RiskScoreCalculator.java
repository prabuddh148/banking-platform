package com.banking.fraud.util;

import com.banking.fraud.config.FraudRulesConfig;
import com.banking.fraud.entity.Decision;
import com.banking.fraud.entity.RiskLevel;
import com.banking.fraud.rules.RuleResult;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Turns rule results into one score, a risk level and a decision:
 * <ul>
 *   <li>score = sum of the triggered rules' scores, capped at 100</li>
 *   <li>level: &lt;30 LOW, &lt;60 MEDIUM, &lt;80 HIGH, else CRITICAL (boundaries configurable)</li>
 *   <li>decision: LOW/MEDIUM = APPROVE, HIGH = REVIEW, CRITICAL = BLOCK</li>
 * </ul>
 */
@Component
@RequiredArgsConstructor
public class RiskScoreCalculator {

    private final FraudRulesConfig config;

    public int totalScore(List<RuleResult> results) {
        int sum = results.stream().filter(RuleResult::triggered).mapToInt(RuleResult::score).sum();
        return Math.max(0, Math.min(sum, config.getRiskLevels().getMaxScore()));
    }

    public RiskLevel riskLevel(int score) {
        FraudRulesConfig.RiskLevels levels = config.getRiskLevels();
        if (score < levels.getMedium()) {
            return RiskLevel.LOW;
        }
        if (score < levels.getHigh()) {
            return RiskLevel.MEDIUM;
        }
        if (score < levels.getCritical()) {
            return RiskLevel.HIGH;
        }
        return RiskLevel.CRITICAL;
    }

    public Decision decision(RiskLevel level) {
        return switch (level) {
            case LOW, MEDIUM -> Decision.APPROVE;
            case HIGH -> Decision.REVIEW;
            case CRITICAL -> Decision.BLOCK;
        };
    }
}

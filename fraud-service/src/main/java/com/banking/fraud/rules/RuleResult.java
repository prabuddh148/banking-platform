package com.banking.fraud.rules;

/**
 * Outcome of one {@link FraudRule}.
 *
 * @param name      rule name
 * @param triggered whether the rule fired
 * @param score     risk points added (0 when not triggered)
 * @param reason    human-readable explanation (null when not triggered)
 */
public record RuleResult(String name, boolean triggered, int score, String reason) {

    public static RuleResult notTriggered(String name) {
        return new RuleResult(name, false, 0, null);
    }

    public static RuleResult triggered(String name, int score, String reason) {
        return new RuleResult(name, true, score, reason);
    }
}

package com.banking.fraud.rules;

/**
 * One fraud check. Every Spring bean implementing this interface is run by the RuleEngineService,
 * so adding a new rule is just adding a new {@code @Component}.
 */
public interface FraudRule {

    /** Short, unique name, e.g. "AMOUNT_THRESHOLD". Shows up in triggeredRules. */
    String name();

    /** Looks at the transaction and says whether this rule fired and how many risk points it adds. */
    RuleResult evaluate(TransactionContext context);
}

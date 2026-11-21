package com.banking.fraud.service;

import com.banking.fraud.entity.Decision;
import com.banking.fraud.entity.RiskLevel;
import com.banking.fraud.rules.RuleResult;

import java.util.List;

/**
 * Combined result of running all fraud rules on one transaction.
 *
 * @param riskScore      0-100
 * @param riskLevel      level derived from the score
 * @param decision       APPROVE / REVIEW / BLOCK
 * @param triggeredRules names of the rules that fired
 * @param reason         explanation (all triggered rules' reasons joined)
 * @param results        every rule's individual result, triggered or not
 */
public record FraudEvaluation(int riskScore,
                              RiskLevel riskLevel,
                              Decision decision,
                              List<String> triggeredRules,
                              String reason,
                              List<RuleResult> results) {
}

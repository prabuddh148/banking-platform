package com.banking.fraud;

import com.banking.fraud.config.FraudRulesConfig;
import com.banking.fraud.entity.Decision;
import com.banking.fraud.entity.FraudDecision;
import com.banking.fraud.entity.RiskLevel;
import com.banking.fraud.repository.FraudDecisionRepository;
import com.banking.fraud.rules.AmountThresholdRule;
import com.banking.fraud.rules.FraudRule;
import com.banking.fraud.rules.GeographicRule;
import com.banking.fraud.rules.PatternAnomalyRule;
import com.banking.fraud.rules.RuleResult;
import com.banking.fraud.rules.TransactionContext;
import com.banking.fraud.rules.VelocityRule;
import com.banking.fraud.service.FraudEvaluation;
import com.banking.fraud.service.RuleEngineService;
import com.banking.fraud.util.RiskScoreCalculator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Unit tests for the individual fraud rules, the score/level/decision mapping and the rule engine.
 * Plain objects + a mocked repository: no Spring context, no database.
 */
class FraudRuleEngineTest {

    private static final String ACCOUNT = "ACC-1";
    /** 12:00 IST = 06:30 UTC: daytime, so the night check stays quiet. */
    private static final Instant DAYTIME = Instant.parse("2026-01-15T06:30:00Z");
    /** 02:00 IST = 20:30 UTC on the previous day. */
    private static final Instant NIGHT = Instant.parse("2026-01-14T20:30:00Z");

    private FraudRulesConfig config;
    private FraudDecisionRepository repository;
    private RiskScoreCalculator calculator;

    @BeforeEach
    void setUp() {
        config = new FraudRulesConfig();
        repository = mock(FraudDecisionRepository.class);
        calculator = new RiskScoreCalculator(config);
    }

    private static TransactionContext tx(String amount, String country, Instant at) {
        return new TransactionContext("TX-1", ACCOUNT, new BigDecimal(amount), "INR", "TRANSFER", country, at);
    }

    private static List<FraudDecision> history(String... amounts) {
        return java.util.Arrays.stream(amounts)
                .map(a -> FraudDecision.builder().accountId(ACCOUNT).amount(new BigDecimal(a)).build())
                .toList();
    }

    @Nested
    class AmountThreshold {
        private final AmountThresholdRule rule = new AmountThresholdRule(new FraudRulesConfig());

        @Test
        void smallAmountDoesNotTrigger() {
            assertThat(rule.evaluate(tx("100000", null, DAYTIME)).triggered()).isFalse();
        }

        @Test
        void aboveHighThresholdAdds40() {
            RuleResult result = rule.evaluate(tx("100000.01", null, DAYTIME));
            assertThat(result.triggered()).isTrue();
            assertThat(result.score()).isEqualTo(40);
            assertThat(result.name()).isEqualTo(AmountThresholdRule.NAME);
        }

        @Test
        void aboveVeryHighThresholdAdds70() {
            RuleResult result = rule.evaluate(tx("500001", null, DAYTIME));
            assertThat(result.score()).isEqualTo(70);
        }
    }

    @Nested
    class Velocity {
        @Test
        void fiveTransactionsInWindowIsFine() {
            when(repository.countByAccountIdAndEvaluatedAtAfter(eq(ACCOUNT), any())).thenReturn(4L);
            RuleResult result = new VelocityRule(config, repository).evaluate(tx("100", null, DAYTIME));
            assertThat(result.triggered()).isFalse();
        }

        @Test
        void sixthTransactionInWindowAdds30() {
            when(repository.countByAccountIdAndEvaluatedAtAfter(eq(ACCOUNT), any())).thenReturn(5L);
            RuleResult result = new VelocityRule(config, repository).evaluate(tx("100", null, DAYTIME));
            assertThat(result.triggered()).isTrue();
            assertThat(result.score()).isEqualTo(30);
        }

        @Test
        void windowStartsTenMinutesBeforeTransaction() {
            Instant expectedSince = DAYTIME.minusSeconds(600);
            when(repository.countByAccountIdAndEvaluatedAtAfter(ACCOUNT, expectedSince)).thenReturn(10L);
            assertThat(new VelocityRule(config, repository).evaluate(tx("100", null, DAYTIME)).triggered()).isTrue();
        }
    }

    @Nested
    class Geographic {
        private final GeographicRule rule = new GeographicRule(new FraudRulesConfig());

        @Test
        void unknownCountryDoesNotTrigger() {
            assertThat(rule.evaluate(tx("100", null, DAYTIME)).triggered()).isFalse();
        }

        @Test
        void allowedCountryDoesNotTrigger() {
            assertThat(rule.evaluate(tx("100", "in", DAYTIME)).triggered()).isFalse();
        }

        @Test
        void foreignCountryAdds25() {
            RuleResult result = rule.evaluate(tx("100", "US", DAYTIME));
            assertThat(result.triggered()).isTrue();
            assertThat(result.score()).isEqualTo(25);
        }
    }

    @Nested
    class PatternAnomaly {
        private PatternAnomalyRule rule() {
            return new PatternAnomalyRule(config, repository);
        }

        @Test
        void amountFarAboveAverageAdds20() {
            when(repository.findByAccountIdOrderByEvaluatedAtDesc(eq(ACCOUNT), any()))
                    .thenReturn(history("1000", "1000", "1000"));
            RuleResult result = rule().evaluate(tx("5001", null, DAYTIME));
            assertThat(result.triggered()).isTrue();
            assertThat(result.score()).isEqualTo(20);
        }

        @Test
        void amountExactlyFiveTimesAverageIsFine() {
            when(repository.findByAccountIdOrderByEvaluatedAtDesc(eq(ACCOUNT), any()))
                    .thenReturn(history("1000", "1000", "1000"));
            assertThat(rule().evaluate(tx("5000", null, DAYTIME)).triggered()).isFalse();
        }

        @Test
        void tooLittleHistoryIsIgnored() {
            when(repository.findByAccountIdOrderByEvaluatedAtDesc(eq(ACCOUNT), any()))
                    .thenReturn(history("10", "10"));
            assertThat(rule().evaluate(tx("90000", null, DAYTIME)).triggered()).isFalse();
        }

        @Test
        void nightTransactionAdds10() {
            when(repository.findByAccountIdOrderByEvaluatedAtDesc(anyString(), any())).thenReturn(List.of());
            RuleResult result = rule().evaluate(tx("100", null, NIGHT));
            assertThat(result.triggered()).isTrue();
            assertThat(result.score()).isEqualTo(10);
        }

        @Test
        void anomalyAndNightTogetherAdd30() {
            when(repository.findByAccountIdOrderByEvaluatedAtDesc(eq(ACCOUNT), any()))
                    .thenReturn(history("100", "100", "100", "100"));
            assertThat(rule().evaluate(tx("1000", null, NIGHT)).score()).isEqualTo(30);
        }
    }

    @Nested
    class ScoreMapping {
        @ParameterizedTest
        @CsvSource({
                "0, LOW, APPROVE",
                "29, LOW, APPROVE",
                "30, MEDIUM, APPROVE",
                "59, MEDIUM, APPROVE",
                "60, HIGH, REVIEW",
                "79, HIGH, REVIEW",
                "80, CRITICAL, BLOCK",
                "100, CRITICAL, BLOCK"
        })
        void levelAndDecisionFollowScore(int score, RiskLevel level, Decision decision) {
            assertThat(calculator.riskLevel(score)).isEqualTo(level);
            assertThat(calculator.decision(calculator.riskLevel(score))).isEqualTo(decision);
        }

        @Test
        void scoreIsSumOfTriggeredRulesCappedAt100() {
            List<RuleResult> results = List.of(
                    RuleResult.triggered("A", 70, "a"),
                    RuleResult.triggered("B", 30, "b"),
                    RuleResult.triggered("C", 25, "c"),
                    RuleResult.notTriggered("D"));
            assertThat(calculator.totalScore(results)).isEqualTo(100);
            assertThat(calculator.totalScore(results.subList(1, 4))).isEqualTo(55);
        }
    }

    @Nested
    class Engine {
        private RuleEngineService engine() {
            List<FraudRule> rules = List.of(
                    new AmountThresholdRule(config),
                    new VelocityRule(config, repository),
                    new GeographicRule(config),
                    new PatternAnomalyRule(config, repository));
            return new RuleEngineService(rules, calculator);
        }

        @Test
        void ordinaryTransactionIsApproved() {
            when(repository.findByAccountIdOrderByEvaluatedAtDesc(anyString(), any())).thenReturn(List.of());
            FraudEvaluation evaluation = engine().evaluate(tx("2500", "IN", DAYTIME));
            assertThat(evaluation.riskScore()).isZero();
            assertThat(evaluation.riskLevel()).isEqualTo(RiskLevel.LOW);
            assertThat(evaluation.decision()).isEqualTo(Decision.APPROVE);
            assertThat(evaluation.triggeredRules()).isEmpty();
            assertThat(evaluation.results()).hasSize(4);
        }

        @Test
        void largeForeignTransactionNeedsReview() {
            when(repository.findByAccountIdOrderByEvaluatedAtDesc(anyString(), any())).thenReturn(List.of());
            FraudEvaluation evaluation = engine().evaluate(tx("200000", "US", DAYTIME)); // 40 + 25
            assertThat(evaluation.riskScore()).isEqualTo(65);
            assertThat(evaluation.riskLevel()).isEqualTo(RiskLevel.HIGH);
            assertThat(evaluation.decision()).isEqualTo(Decision.REVIEW);
            assertThat(evaluation.triggeredRules()).containsExactly(AmountThresholdRule.NAME, GeographicRule.NAME);
        }

        @Test
        void hugeRapidTransactionsAreBlocked() {
            when(repository.countByAccountIdAndEvaluatedAtAfter(anyString(), any())).thenReturn(9L);
            when(repository.findByAccountIdOrderByEvaluatedAtDesc(anyString(), any()))
                    .thenReturn(IntStream.range(0, 5).mapToObj(i -> history("1000").get(0)).toList());
            FraudEvaluation evaluation = engine().evaluate(tx("600000", "US", NIGHT)); // 70+30+25+30 -> 100
            assertThat(evaluation.riskScore()).isEqualTo(100);
            assertThat(evaluation.riskLevel()).isEqualTo(RiskLevel.CRITICAL);
            assertThat(evaluation.decision()).isEqualTo(Decision.BLOCK);
            assertThat(evaluation.triggeredRules()).hasSize(4);
        }

        @Test
        void brokenRuleIsSkipped() {
            FraudRule broken = new FraudRule() {
                @Override
                public String name() {
                    return "BROKEN";
                }

                @Override
                public RuleResult evaluate(TransactionContext context) {
                    throw new IllegalStateException("boom");
                }
            };
            RuleEngineService engine = new RuleEngineService(List.of(broken, new AmountThresholdRule(config)), calculator);
            FraudEvaluation evaluation = engine.evaluate(tx("150000", null, DAYTIME));
            assertThat(evaluation.riskScore()).isEqualTo(40);
            assertThat(evaluation.decision()).isEqualTo(Decision.APPROVE);
        }
    }
}

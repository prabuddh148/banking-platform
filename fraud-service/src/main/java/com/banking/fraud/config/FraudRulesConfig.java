package com.banking.fraud.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/**
 * All fraud-rule thresholds and scores, bound from {@code fraud.rules.*} in application.yml.
 * <p>
 * The defaults below match the values in application.yml, so the class also works when it is
 * created with {@code new FraudRulesConfig()} (handy in unit tests).
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "fraud.rules")
public class FraudRulesConfig {

    private AmountThreshold amountThreshold = new AmountThreshold();
    private Velocity velocity = new Velocity();
    private Geographic geographic = new Geographic();
    private PatternAnomaly patternAnomaly = new PatternAnomaly();
    private RiskLevels riskLevels = new RiskLevels();

    /** Large amounts are risky: amount > highAmount adds highScore, amount > veryHighAmount adds veryHighScore. */
    @Getter
    @Setter
    public static class AmountThreshold {
        private boolean enabled = true;
        private BigDecimal highAmount = new BigDecimal("100000");
        private int highScore = 40;
        private BigDecimal veryHighAmount = new BigDecimal("500000");
        private int veryHighScore = 70;
    }

    /** Too many transactions on one account in a short time window. */
    @Getter
    @Setter
    public static class Velocity {
        private boolean enabled = true;
        /** Triggers when the account has MORE than this many transactions in the window (incl. the current one). */
        private int maxTransactions = 5;
        private int windowMinutes = 10;
        private int score = 30;
    }

    /** Transactions from countries outside the allowed list. */
    @Getter
    @Setter
    public static class Geographic {
        private boolean enabled = true;
        private List<String> allowedCountries = new ArrayList<>(List.of("IN"));
        private int score = 25;
    }

    /** Unusual amount compared to the account's history, or unusual time of day. */
    @Getter
    @Setter
    public static class PatternAnomaly {
        private boolean enabled = true;
        /** amount > multiplier x average of recent amounts is an anomaly. */
        private BigDecimal multiplier = new BigDecimal("5");
        /** How many recent decisions form the "history". */
        private int historySize = 20;
        /** Need at least this many past decisions before the average is meaningful. */
        private int minHistory = 3;
        private int amountAnomalyScore = 20;
        /** Night window [nightStartHour, nightEndHour) in {@link #timeZone}. */
        private int nightStartHour = 0;
        private int nightEndHour = 5;
        private int nightScore = 10;
        private String timeZone = "Asia/Kolkata";
    }

    /** Score boundaries: score < medium = LOW, < high = MEDIUM, < critical = HIGH, else CRITICAL. */
    @Getter
    @Setter
    public static class RiskLevels {
        private int medium = 30;
        private int high = 60;
        private int critical = 80;
        private int maxScore = 100;
    }
}

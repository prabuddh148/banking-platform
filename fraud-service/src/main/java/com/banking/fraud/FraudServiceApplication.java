package com.banking.fraud;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * Entry point of the fraud-service.
 * <p>
 * It listens for TRANSACTION_INITIATED events, scores each transaction with a set of fraud rules,
 * stores the decision and publishes FRAUD_CLEARED / FRAUD_DETECTED. Admins review suspicious
 * transactions through the REST API.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class FraudServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(FraudServiceApplication.class, args);
    }
}

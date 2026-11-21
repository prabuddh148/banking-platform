package com.banking.transaction;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Entry point of transaction-service.
 * <p>
 * This service accepts deposit / withdrawal / transfer requests and orchestrates the saga
 * (fraud check -> balance update -> completed/failed) by exchanging Kafka events with
 * fraud-service and account-service. Scheduling is enabled for the outbox relay and the
 * saga-timeout job.
 */
@SpringBootApplication
@EnableScheduling
public class TransactionServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(TransactionServiceApplication.class, args);
    }
}

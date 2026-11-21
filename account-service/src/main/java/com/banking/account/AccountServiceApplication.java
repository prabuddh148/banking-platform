package com.banking.account;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Entry point of account-service (port 8081): accounts, balances, and the balance-update step
 * of the transaction saga. Extra features (scheduling, security, Kafka) are switched on in the
 * classes under {@code config/}, which keeps slice tests like @WebMvcTest light.
 */
@SpringBootApplication
public class AccountServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(AccountServiceApplication.class, args);
    }
}

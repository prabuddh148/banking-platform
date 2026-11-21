package com.banking.audit;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration;

/**
 * Entry point of the audit-service.
 * <p>
 * The service listens to the account, transaction and fraud Kafka topics, stores every event as an
 * immutable {@code audit_logs} row and offers admin-only REST endpoints to search those logs.
 */
// Users come from the JWT, so Boot's default in-memory user (and its generated password) is not needed.
@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)
public class AuditServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(AuditServiceApplication.class, args);
    }
}

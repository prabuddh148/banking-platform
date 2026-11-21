package com.banking.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.reactive.ReactiveUserDetailsServiceAutoConfiguration;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * Entry point of the API gateway: the single door into the banking platform.
 * <p>
 * It issues JWTs for the demo users, validates the token on every other request and
 * proxies requests to the downstream services (with a circuit breaker per service).
 * <p>
 * {@link ReactiveUserDetailsServiceAutoConfiguration} is excluded because we do not want Spring
 * Security's generated default user — our users come from {@code gateway.auth.users}.
 */
@SpringBootApplication(exclude = ReactiveUserDetailsServiceAutoConfiguration.class)
@ConfigurationPropertiesScan
public class ApiGatewayApplication {

    public static void main(String[] args) {
        SpringApplication.run(ApiGatewayApplication.class, args);
    }
}

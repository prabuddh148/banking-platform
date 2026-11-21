package com.banking.gateway.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * Typed view of everything under {@code gateway.*} in application.yml:
 * downstream services, demo users, CORS origins and circuit breaker settings.
 * <p>
 * (Not called "GatewayProperties" to avoid confusion with Spring Cloud Gateway's own class.)
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "gateway")
public class GatewayAppProperties {

    /** Downstream services the gateway routes to. */
    private List<ServiceRoute> services = new ArrayList<>();

    private Auth auth = new Auth();

    private Cors cors = new Cors();

    private CircuitBreaker circuitBreaker = new CircuitBreaker();

    /** One downstream service: its name, the path it owns and where it runs. */
    @Getter
    @Setter
    public static class ServiceRoute {
        /** e.g. "account-service" — also the route id and circuit breaker name. */
        private String name;
        /** e.g. "/api/v1/accounts/**" */
        private String path;
        /** e.g. "http://localhost:8081" */
        private String uri;
    }

    @Getter
    @Setter
    public static class Auth {
        private List<DemoUser> users = new ArrayList<>();
    }

    /** A demo login. {@code password} is an encoded value such as "{bcrypt}$2a$10$..." or "{noop}secret". */
    @Getter
    @Setter
    public static class DemoUser {
        private String username;
        private String password;
        private String userId;
        private String name;
        private String email;
        private List<String> roles = new ArrayList<>();
    }

    @Getter
    @Setter
    public static class Cors {
        /** Origins allowed to call the gateway from a browser. */
        private List<String> allowedOrigins = new ArrayList<>(List.of("http://localhost:5173"));
    }

    @Getter
    @Setter
    public static class CircuitBreaker {
        /** Maximum time a downstream call may take before the circuit breaker treats it as failed. */
        private Duration timeout = Duration.ofSeconds(10);
    }
}

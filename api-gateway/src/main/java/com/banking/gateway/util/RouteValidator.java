package com.banking.gateway.util;

import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;

import java.util.List;

/**
 * Knows which endpoints are open (no JWT needed). Everything else is secured.
 * <p>
 * Open: the login endpoint (you cannot have a token before logging in) and the actuator
 * endpoints (health checks, metrics scraping by Prometheus).
 */
@Component
public class RouteValidator {

    public static final List<String> OPEN_ENDPOINTS = List.of(
            "/api/v1/auth/login",
            "/actuator",
            "/actuator/**"
    );

    private final AntPathMatcher pathMatcher = new AntPathMatcher();

    /** True if the path can be called without a token. */
    public boolean isOpen(String path) {
        return OPEN_ENDPOINTS.stream().anyMatch(pattern -> pathMatcher.match(pattern, path));
    }

    /** True if the request needs a valid JWT. */
    public boolean isSecured(ServerHttpRequest request) {
        return !isOpen(request.getPath().value());
    }
}

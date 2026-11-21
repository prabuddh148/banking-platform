package com.banking.gateway.config;

import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import io.github.resilience4j.timelimiter.TimeLimiterConfig;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cloud.circuitbreaker.resilience4j.ReactiveResilience4JCircuitBreakerFactory;
import org.springframework.cloud.circuitbreaker.resilience4j.Resilience4JConfigBuilder;
import org.springframework.cloud.client.circuitbreaker.Customizer;
import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

/**
 * Builds one gateway route per entry in {@code gateway.services}.
 * <p>
 * Every route gets its own circuit breaker (named after the service). When the service is down,
 * slow or the breaker is open, the request is forwarded to {@code /fallback/{service}}, which
 * answers with a 503 {@code ApiResponse} instead of a raw connection error.
 */
@Slf4j
@Configuration
@RequiredArgsConstructor
public class GatewayRouteConfig {

    private final GatewayAppProperties properties;

    @Bean
    public RouteLocator bankingRoutes(RouteLocatorBuilder builder) {
        RouteLocatorBuilder.Builder routes = builder.routes();
        for (GatewayAppProperties.ServiceRoute service : properties.getServices()) {
            log.info("Route {} -> {} ({})", service.getPath(), service.getUri(), service.getName());
            routes.route(service.getName(), r -> r
                    .path(service.getPath())
                    .filters(f -> f
                            // If a downstream service also sends CORS headers, keep only one copy.
                            .dedupeResponseHeader("Access-Control-Allow-Origin Access-Control-Allow-Credentials",
                                    "RETAIN_FIRST")
                            .circuitBreaker(cb -> cb
                                    .setName(service.getName())
                                    .setFallbackUri("forward:/fallback/" + service.getName())))
                    .uri(service.getUri()));
        }
        return routes.build();
    }

    /**
     * Default settings for every circuit breaker: open after 50% failures in the last 20 calls,
     * stay open for 15 seconds, and count a call as failed if it takes longer than the timeout.
     */
    @Bean
    public Customizer<ReactiveResilience4JCircuitBreakerFactory> defaultCircuitBreakerCustomizer() {
        Duration timeout = properties.getCircuitBreaker().getTimeout();
        return factory -> factory.configureDefault(id -> new Resilience4JConfigBuilder(id)
                .circuitBreakerConfig(CircuitBreakerConfig.custom()
                        .slidingWindowSize(20)
                        .minimumNumberOfCalls(10)
                        .failureRateThreshold(50)
                        .waitDurationInOpenState(Duration.ofSeconds(15))
                        .permittedNumberOfCallsInHalfOpenState(3)
                        .build())
                .timeLimiterConfig(TimeLimiterConfig.custom().timeoutDuration(timeout).build())
                .build());
    }
}

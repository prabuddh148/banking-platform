package com.banking.gateway.health;

import com.banking.gateway.config.GatewayAppProperties;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.List;

/**
 * Calls {@code <service uri>/actuator/health} for all services in parallel (2 second timeout each).
 * A service is UP only if it answers 2xx with {@code "status":"UP"}; any error, timeout or other
 * status counts as DOWN.
 */
@Slf4j
@Service
public class SystemHealthServiceImpl implements SystemHealthService {

    private static final Duration TIMEOUT = Duration.ofSeconds(2);

    private final GatewayAppProperties properties;
    private final WebClient webClient;

    public SystemHealthServiceImpl(GatewayAppProperties properties, WebClient.Builder webClientBuilder) {
        this.properties = properties;
        this.webClient = webClientBuilder.build();
    }

    @Override
    public Mono<List<ServiceHealthResponse>> checkAll() {
        return Flux.fromIterable(properties.getServices())
                .flatMapSequential(this::check)
                .collectList();
    }

    private Mono<ServiceHealthResponse> check(GatewayAppProperties.ServiceRoute service) {
        String url = stripTrailingSlash(service.getUri()) + "/actuator/health";
        return Mono.defer(() -> {
            long start = System.nanoTime();
            return webClient.get()
                    .uri(url)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .map(body -> "UP".equalsIgnoreCase(body.path("status").asText()) ? "UP" : "DOWN")
                    .timeout(TIMEOUT)
                    .onErrorResume(e -> {
                        log.debug("Health check of {} failed: {}", service.getName(), e.toString());
                        return Mono.just("DOWN");
                    })
                    .defaultIfEmpty("DOWN")
                    .map(status -> new ServiceHealthResponse(service.getName(), url, status,
                            Duration.ofNanos(System.nanoTime() - start).toMillis()));
        });
    }

    private static String stripTrailingSlash(String uri) {
        return uri.endsWith("/") ? uri.substring(0, uri.length() - 1) : uri;
    }
}

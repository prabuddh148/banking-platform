package com.banking.gateway.config;

import com.banking.common.security.SecurityConstants;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.reactive.CorsWebFilter;
import org.springframework.web.cors.reactive.UrlBasedCorsConfigurationSource;

import java.time.Duration;
import java.util.List;

/**
 * Lets the React frontend (default http://localhost:5173, env {@code CORS_ALLOWED_ORIGINS})
 * call the gateway from the browser.
 * <p>
 * The filter runs right after the trace-id and logging filters, so browser pre-flight
 * (OPTIONS) requests are answered here before the JWT filter would ask for a token.
 */
@Configuration
@RequiredArgsConstructor
public class CorsConfig {

    private final GatewayAppProperties properties;

    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE + 2)
    public CorsWebFilter corsWebFilter() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(properties.getCors().getAllowedOrigins().stream()
                .map(String::trim)
                .filter(origin -> !origin.isEmpty())
                .toList());
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setExposedHeaders(List.of(SecurityConstants.HEADER_TRACE_ID));
        config.setAllowCredentials(true);
        config.setMaxAge(Duration.ofHours(1));

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return new CorsWebFilter(source);
    }
}

package com.banking.gateway.filter;

import com.banking.common.security.SecurityConstants;
import org.springframework.core.Ordered;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

import java.util.UUID;

/**
 * Runs FIRST for every request. Makes sure each request has an {@code X-Trace-Id}:
 * keeps the client's one if present, otherwise generates a UUID. The id is sent to the
 * downstream service (so logs across services can be correlated) and returned to the client.
 */
@Component
public class TraceIdPropagationFilter implements WebFilter, Ordered {

    /** Exchange attribute holding the trace id, for other filters/handlers. */
    public static final String TRACE_ID_ATTRIBUTE = "gateway.traceId";

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        String traceId = exchange.getRequest().getHeaders().getFirst(SecurityConstants.HEADER_TRACE_ID);
        if (!StringUtils.hasText(traceId)) {
            traceId = UUID.randomUUID().toString();
        }
        final String finalTraceId = traceId;

        ServerHttpRequest request = exchange.getRequest().mutate()
                .headers(headers -> headers.set(SecurityConstants.HEADER_TRACE_ID, finalTraceId))
                .build();
        exchange.getResponse().getHeaders().set(SecurityConstants.HEADER_TRACE_ID, finalTraceId);
        exchange.getAttributes().put(TRACE_ID_ATTRIBUTE, finalTraceId);

        return chain.filter(exchange.mutate().request(request).build());
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }
}

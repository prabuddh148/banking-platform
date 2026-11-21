package com.banking.gateway.filter;

import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

/**
 * Logs one line per request: method, path, response status, duration and trace id.
 * <p>
 * The line is written just before the response is sent ({@code beforeCommit}), so the status is
 * the final one — also when the request was rejected by the JWT filter or ended in an error.
 */
@Slf4j
@Component
public class RequestLoggingFilter implements WebFilter, Ordered {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        long start = System.currentTimeMillis();
        String method = exchange.getRequest().getMethod().name();
        String path = exchange.getRequest().getURI().getRawPath();

        exchange.getResponse().beforeCommit(() -> {
            HttpStatusCode status = exchange.getResponse().getStatusCode();
            String traceId = exchange.getAttribute(TraceIdPropagationFilter.TRACE_ID_ATTRIBUTE);
            log.info("{} {} -> {} ({} ms) traceId={}", method, path,
                    status != null ? status.value() : "-", System.currentTimeMillis() - start, traceId);
            return Mono.empty();
        });
        return chain.filter(exchange);
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 1;
    }
}

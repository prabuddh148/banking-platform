package com.banking.gateway.fallback;

import com.banking.common.dto.ApiResponse;
import com.banking.common.exception.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cloud.gateway.support.ServerWebExchangeUtils;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * Target of the circuit breakers ({@code forward:/fallback/{service}}): when a downstream service is
 * down, too slow or its breaker is open, the client gets a clean 503 {@code ApiResponse}
 * (code SERVICE_UNAVAILABLE) instead of a connection error.
 * Mapped for all HTTP methods, because the original request may be a GET, POST, PATCH, ...
 */
@Slf4j
@RestController
public class FallbackController {

    @RequestMapping("/fallback/{service}")
    public Mono<ResponseEntity<ApiResponse<Void>>> fallback(@PathVariable String service,
                                                            ServerWebExchange exchange) {
        Throwable cause = exchange.getAttribute(ServerWebExchangeUtils.CIRCUITBREAKER_EXECUTION_EXCEPTION_ATTR);
        log.warn("Fallback for {}: {}", service, cause != null ? cause.toString() : "circuit open");

        ApiResponse<Void> body = ApiResponse.error(ErrorCode.SERVICE_UNAVAILABLE,
                service + " is temporarily unavailable. Please try again later.");
        return Mono.just(ResponseEntity.status(ErrorCode.SERVICE_UNAVAILABLE.getStatus()).body(body));
    }
}

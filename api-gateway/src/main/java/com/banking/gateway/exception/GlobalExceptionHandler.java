package com.banking.gateway.exception;

import com.banking.common.dto.ApiResponse;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.web.reactive.error.ErrorWebExceptionHandler;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.support.WebExchangeBindException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.net.ConnectException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeoutException;

/**
 * Catches every error in the gateway (filters, controllers, proxying) and writes it as an
 * {@code ApiResponse} JSON body, so clients always get the same error format as from the services.
 * <p>
 * Order -2 makes it run before Spring Boot's default handler (order -1), which would render a
 * different JSON shape.
 */
@Slf4j
@Component
@Order(-2)
@RequiredArgsConstructor
public class GlobalExceptionHandler implements ErrorWebExceptionHandler {

    private final ObjectMapper objectMapper;

    @Override
    public Mono<Void> handle(ServerWebExchange exchange, Throwable ex) {
        ServerHttpResponse response = exchange.getResponse();
        if (response.isCommitted()) {
            // Headers are already sent; nothing sensible can be written any more.
            return Mono.error(ex);
        }

        ApiResponse<Void> body = toApiResponse(ex, exchange);
        response.setStatusCode(HttpStatus.valueOf(body.getError().getStatus()));
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);

        byte[] bytes;
        try {
            bytes = objectMapper.writeValueAsBytes(body);
        } catch (JsonProcessingException e) {
            bytes = "{\"error\":{\"code\":\"INTERNAL_ERROR\"}}".getBytes(StandardCharsets.UTF_8);
        }
        DataBuffer buffer = response.bufferFactory().wrap(bytes);
        return response.writeWith(Mono.just(buffer));
    }

    private ApiResponse<Void> toApiResponse(Throwable ex, ServerWebExchange exchange) {
        String path = exchange.getRequest().getPath().value();

        if (ex instanceof BankingException be) {
            log.debug("{} on {}: {}", be.getErrorCode(), path, be.getMessage());
            return ApiResponse.error(be.getErrorCode(), be.getMessage());
        }
        if (ex instanceof WebExchangeBindException bind) {
            Map<String, String> details = new LinkedHashMap<>();
            for (FieldError fieldError : bind.getFieldErrors()) {
                details.putIfAbsent(fieldError.getField(), fieldError.getDefaultMessage());
            }
            return ApiResponse.error(ErrorCode.VALIDATION_ERROR, ErrorCode.VALIDATION_ERROR.getMessage(), details);
        }
        if (ex instanceof ResponseStatusException rse) {
            ErrorCode code = fromStatus(rse.getStatusCode());
            String message = rse.getReason() != null ? rse.getReason() : code.getMessage();
            return ApiResponse.error(code, message);
        }
        if (ex instanceof ConnectException || ex instanceof TimeoutException) {
            log.warn("Downstream unavailable for {}: {}", path, ex.toString());
            return ApiResponse.error(ErrorCode.SERVICE_UNAVAILABLE, ErrorCode.SERVICE_UNAVAILABLE.getMessage());
        }

        log.error("Unexpected error on {}", path, ex);
        return ApiResponse.error(ErrorCode.INTERNAL_ERROR, ErrorCode.INTERNAL_ERROR.getMessage());
    }

    private static ErrorCode fromStatus(HttpStatusCode status) {
        return switch (status.value()) {
            case 400 -> ErrorCode.BAD_REQUEST;
            case 401 -> ErrorCode.UNAUTHORIZED;
            case 403 -> ErrorCode.FORBIDDEN;
            case 404 -> ErrorCode.NOT_FOUND;
            case 409 -> ErrorCode.CONFLICT;
            case 502, 503, 504 -> ErrorCode.SERVICE_UNAVAILABLE;
            default -> status.is4xxClientError() ? ErrorCode.BAD_REQUEST : ErrorCode.INTERNAL_ERROR;
        };
    }
}

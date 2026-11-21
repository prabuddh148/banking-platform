package com.banking.gateway.health;

import com.banking.common.dto.ApiResponse;
import com.banking.common.exception.ErrorCode;
import com.banking.common.security.AuthenticatedUser;
import com.banking.gateway.exception.GatewayException;
import com.banking.gateway.filter.JwtAuthenticationFilter;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.util.List;

/**
 * {@code GET /api/v1/system/health} (admin only): health of every downstream service,
 * used by the frontend's "Service Health" page.
 */
@RestController
@RequestMapping("/api/v1/system")
@RequiredArgsConstructor
public class SystemHealthController {

    private final SystemHealthService systemHealthService;

    @GetMapping("/health")
    public Mono<ApiResponse<List<ServiceHealthResponse>>> health(ServerWebExchange exchange) {
        return Mono.defer(() -> {
            AuthenticatedUser user = JwtAuthenticationFilter.requireUser(exchange);
            if (!user.isAdmin()) {
                return Mono.error(new GatewayException(ErrorCode.FORBIDDEN, "Admin role required"));
            }
            return systemHealthService.checkAll().map(ApiResponse::success);
        });
    }
}

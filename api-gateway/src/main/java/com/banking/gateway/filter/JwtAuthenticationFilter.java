package com.banking.gateway.filter;

import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.JwtUtil;
import com.banking.common.security.SecurityConstants;
import com.banking.gateway.exception.GatewayException;
import com.banking.gateway.util.JwtTokenUtil;
import com.banking.gateway.util.RouteValidator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.http.HttpMethod;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

/**
 * Authenticates every request with the JWT from {@code Authorization: Bearer <token>}.
 * <ol>
 *   <li>Removes any {@code X-User-Id}/{@code X-User-Roles} the client sent (they must not be spoofable).</li>
 *   <li>Open endpoints (see {@link RouteValidator}) and CORS pre-flight requests pass through.</li>
 *   <li>Otherwise: no/invalid token → 401 {@code ApiResponse}; valid token → adds {@code X-User-Id} and
 *       {@code X-User-Roles} for the downstream service (the Authorization header is kept, because the
 *       services validate the token again) and stores the user in the exchange attributes for the
 *       gateway's own controllers ({@code /api/v1/auth/me}, {@code /api/v1/system/health}).</li>
 * </ol>
 * It is a {@link WebFilter} (not a Gateway {@code GlobalFilter}) on purpose: global filters only run for
 * proxied routes, while a web filter also protects the gateway's own controllers.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter implements WebFilter, Ordered {

    /** Exchange attribute holding the {@link AuthenticatedUser} of a validated request. */
    public static final String USER_ATTRIBUTE = "gateway.authenticatedUser";

    private final JwtTokenUtil jwtTokenUtil;
    private final RouteValidator routeValidator;

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();

        // 1. Never trust identity headers coming from outside.
        ServerHttpRequest.Builder requestBuilder = request.mutate().headers(headers -> {
            headers.remove(SecurityConstants.HEADER_USER_ID);
            headers.remove(SecurityConstants.HEADER_USER_ROLES);
        });

        // 2. Open endpoints and browser pre-flight requests do not need a token.
        if (HttpMethod.OPTIONS.equals(request.getMethod()) || !routeValidator.isSecured(request)) {
            return chain.filter(exchange.mutate().request(requestBuilder.build()).build());
        }

        // 3. Everything else needs a valid bearer token.
        String token = JwtUtil.extractBearerToken(
                request.getHeaders().getFirst(SecurityConstants.AUTHORIZATION_HEADER));
        if (token == null) {
            return Mono.error(new GatewayException(ErrorCode.UNAUTHORIZED,
                    "Missing or malformed Authorization header"));
        }

        AuthenticatedUser user;
        try {
            user = jwtTokenUtil.validateToken(token);
        } catch (BankingException e) {
            log.debug("Rejected token for {}: {}", request.getPath(), e.getMessage());
            return Mono.error(e);
        }

        ServerHttpRequest authenticatedRequest = requestBuilder
                .header(SecurityConstants.HEADER_USER_ID, user.userId())
                .header(SecurityConstants.HEADER_USER_ROLES, String.join(",", user.roles()))
                .build();
        exchange.getAttributes().put(USER_ATTRIBUTE, user);
        return chain.filter(exchange.mutate().request(authenticatedRequest).build());
    }

    /**
     * The user of the current request, as validated by this filter.
     *
     * @throws GatewayException UNAUTHORIZED if the request was not authenticated
     */
    public static AuthenticatedUser requireUser(ServerWebExchange exchange) {
        AuthenticatedUser user = exchange.getAttribute(USER_ATTRIBUTE);
        if (user == null) {
            throw new GatewayException(ErrorCode.UNAUTHORIZED);
        }
        return user;
    }

    @Override
    public int getOrder() {
        // After trace id, logging and CORS (HIGHEST_PRECEDENCE .. +2) and Spring Security (-100).
        return -50;
    }
}

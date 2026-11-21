package com.banking.gateway.auth;

import com.banking.common.dto.ApiResponse;
import com.banking.gateway.auth.dto.LoginRequest;
import com.banking.gateway.auth.dto.LoginResponse;
import com.banking.gateway.auth.dto.UserResponse;
import com.banking.gateway.filter.JwtAuthenticationFilter;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * Login and "who am I" endpoints, served by the gateway itself (not proxied).
 * <ul>
 *   <li>{@code POST /api/v1/auth/login} — open; returns a JWT for a demo user.</li>
 *   <li>{@code GET /api/v1/auth/me} — needs a token; returns the user inside it.</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/login")
    public Mono<ApiResponse<LoginResponse>> login(@Valid @RequestBody LoginRequest request) {
        // BCrypt is CPU heavy; Mono.fromCallable keeps the code simple and errors flow to the handler.
        return Mono.fromCallable(() -> ApiResponse.success(authService.login(request)));
    }

    @GetMapping("/me")
    public Mono<ApiResponse<UserResponse>> me(ServerWebExchange exchange) {
        return Mono.fromCallable(() ->
                ApiResponse.success(UserResponse.from(JwtAuthenticationFilter.requireUser(exchange))));
    }
}

package com.banking.notification.security;

import com.banking.common.dto.ApiResponse;
import com.banking.common.exception.BankingException;
import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.JwtUtil;
import com.banking.common.security.SecurityConstants;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Reads {@code Authorization: Bearer <jwt>}, validates it and puts the {@link AuthenticatedUser}
 * into Spring Security's context (so {@code CurrentUser} and {@code @PreAuthorize} work).
 * <ul>
 *     <li>no token -> continue; the entry point answers 401 if the endpoint needs a login</li>
 *     <li>bad / expired token -> 401 JSON right away</li>
 * </ul>
 * Not a {@code @Component}: it is created in SecurityConfig so it only runs inside the security chain.
 */
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtTokenValidator tokenValidator;
    private final ObjectMapper objectMapper;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String token = JwtUtil.extractBearerToken(request.getHeader(SecurityConstants.AUTHORIZATION_HEADER));
        if (token == null) {
            chain.doFilter(request, response);
            return;
        }
        try {
            AuthenticatedUser user = tokenValidator.validate(token);
            var authorities = user.roles().stream().map(SimpleGrantedAuthority::new).toList();
            var authentication = new UsernamePasswordAuthenticationToken(user, null, authorities);
            SecurityContextHolder.getContext().setAuthentication(authentication);
        } catch (BankingException e) {
            SecurityContextHolder.clearContext();
            response.setStatus(e.getStatus().value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            objectMapper.writeValue(response.getOutputStream(), ApiResponse.error(e.getErrorCode(), e.getMessage()));
            return;
        }
        chain.doFilter(request, response);
    }
}

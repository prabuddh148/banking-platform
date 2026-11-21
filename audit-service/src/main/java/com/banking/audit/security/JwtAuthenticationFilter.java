package com.banking.audit.security;

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
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Reads the {@code Authorization: Bearer <jwt>} header, validates the token and stores the
 * {@link AuthenticatedUser} in Spring Security's context.
 * <ul>
 *   <li>No token: the request continues unauthenticated (protected URLs then get a 401 from the entry point).</li>
 *   <li>Invalid / expired token: a 401 JSON error is written immediately.</li>
 * </ul>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtTokenValidator tokenValidator;
    private final ObjectMapper objectMapper;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String token = JwtUtil.extractBearerToken(request.getHeader(SecurityConstants.AUTHORIZATION_HEADER));
        if (token == null) {
            filterChain.doFilter(request, response);
            return;
        }

        try {
            AuthenticatedUser user = tokenValidator.validate(token);
            var authorities = user.roles().stream().map(SimpleGrantedAuthority::new).toList();
            var authentication = new UsernamePasswordAuthenticationToken(user, null, authorities);
            SecurityContextHolder.getContext().setAuthentication(authentication);
        } catch (BankingException e) {
            log.debug("Rejected JWT: {}", e.getMessage());
            SecurityContextHolder.clearContext();
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            objectMapper.writeValue(response.getOutputStream(),
                    ApiResponse.error(e.getErrorCode(), e.getErrorCode().getMessage()));
            return;
        }

        filterChain.doFilter(request, response);
    }
}

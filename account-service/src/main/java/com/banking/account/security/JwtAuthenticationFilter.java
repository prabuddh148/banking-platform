package com.banking.account.security;

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
import java.util.List;

/**
 * Runs once per HTTP request:
 * <ol>
 *   <li>No {@code Authorization: Bearer ...} header -> do nothing (protected URLs then get 401
 *       from the entry point in SecurityConfig).</li>
 *   <li>Valid token -> put the {@link AuthenticatedUser} into the SecurityContext as principal,
 *       with its roles as authorities (so {@code hasRole('ADMIN')} works).</li>
 *   <li>Invalid/expired token -> answer 401 JSON right away.</li>
 * </ol>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtTokenValidator jwtTokenValidator;
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
            AuthenticatedUser user = jwtTokenValidator.validate(token);
            List<SimpleGrantedAuthority> authorities = user.roles().stream().map(SimpleGrantedAuthority::new).toList();
            UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(user, null, authorities);
            SecurityContextHolder.getContext().setAuthentication(authentication);
        } catch (BankingException ex) {
            log.debug("Rejected token on {} {}: {}", request.getMethod(), request.getRequestURI(), ex.getMessage());
            SecurityContextHolder.clearContext();
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            objectMapper.writeValue(response.getOutputStream(), ApiResponse.error(ex.getErrorCode(), ex.getMessage()));
            return;
        }
        chain.doFilter(request, response);
    }
}

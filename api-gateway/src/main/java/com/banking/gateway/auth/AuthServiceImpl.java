package com.banking.gateway.auth;

import com.banking.common.exception.ErrorCode;
import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.SecurityConstants;
import com.banking.gateway.auth.dto.LoginRequest;
import com.banking.gateway.auth.dto.LoginResponse;
import com.banking.gateway.auth.dto.UserResponse;
import com.banking.gateway.config.GatewayAppProperties;
import com.banking.gateway.exception.GatewayException;
import com.banking.gateway.util.JwtTokenUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Logs in the demo users configured under {@code gateway.auth.users}.
 * <p>
 * The same error ("Invalid username or password") is returned for an unknown user and a wrong
 * password, so a caller cannot find out which usernames exist.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AuthServiceImpl implements AuthService {

    private final GatewayAppProperties properties;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenUtil jwtTokenUtil;

    @Override
    public LoginResponse login(LoginRequest request) {
        GatewayAppProperties.DemoUser demoUser = properties.getAuth().getUsers().stream()
                .filter(u -> u.getUsername().equalsIgnoreCase(request.username().trim()))
                .findFirst()
                .filter(u -> passwordEncoder.matches(request.password(), u.getPassword()))
                .orElseThrow(() -> {
                    log.info("Failed login for username '{}'", request.username());
                    return new GatewayException(ErrorCode.INVALID_CREDENTIALS);
                });

        AuthenticatedUser user = new AuthenticatedUser(
                demoUser.getUserId(),
                demoUser.getUsername(),
                demoUser.getEmail(),
                demoUser.getName(),
                demoUser.getRoles().isEmpty() ? List.of(SecurityConstants.ROLE_CUSTOMER) : demoUser.getRoles());

        String token = jwtTokenUtil.generateToken(user);
        log.info("User '{}' ({}) logged in", user.username(), user.userId());
        return new LoginResponse(token, "Bearer", jwtTokenUtil.getExpiry().toSeconds(), UserResponse.from(user));
    }
}

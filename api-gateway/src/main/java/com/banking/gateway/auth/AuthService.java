package com.banking.gateway.auth;

import com.banking.gateway.auth.dto.LoginRequest;
import com.banking.gateway.auth.dto.LoginResponse;

/** Checks demo-user credentials and issues JWTs. */
public interface AuthService {

    /**
     * @throws com.banking.gateway.exception.GatewayException INVALID_CREDENTIALS if username/password are wrong
     */
    LoginResponse login(LoginRequest request);
}

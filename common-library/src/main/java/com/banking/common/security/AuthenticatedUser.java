package com.banking.common.security;

import java.util.List;

/**
 * The logged-in user, built from the JWT claims.
 *
 * @param userId   customer/admin id (accounts are owned by this id)
 * @param username login name (JWT subject)
 * @param email    email address, may be null
 * @param name     display name, may be null
 * @param roles    e.g. ROLE_CUSTOMER, ROLE_ADMIN
 */
public record AuthenticatedUser(String userId, String username, String email, String name, List<String> roles) {

    public AuthenticatedUser {
        roles = roles == null ? List.of() : List.copyOf(roles);
    }

    public boolean isAdmin() {
        return roles.contains(SecurityConstants.ROLE_ADMIN);
    }
}

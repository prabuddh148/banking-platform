package com.banking.common.security;

import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Optional;

/**
 * Reads the logged-in user from Spring Security's context (servlet services).
 * The services' JwtAuthenticationFilter must store an {@link AuthenticatedUser} as the principal.
 */
public final class CurrentUser {

    private CurrentUser() {
    }

    public static Optional<AuthenticatedUser> get() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof AuthenticatedUser user) {
            return Optional.of(user);
        }
        return Optional.empty();
    }

    /** @throws BankingException UNAUTHORIZED when nobody is logged in */
    public static AuthenticatedUser require() {
        return get().orElseThrow(() -> new BankingException(ErrorCode.UNAUTHORIZED));
    }

    public static boolean isAdmin() {
        return get().map(AuthenticatedUser::isAdmin).orElse(false);
    }

    /** Throws FORBIDDEN unless the current user is an admin or owns the resource. */
    public static void requireOwnerOrAdmin(String ownerUserId) {
        AuthenticatedUser user = require();
        if (!user.isAdmin() && (ownerUserId == null || !ownerUserId.equals(user.userId()))) {
            throw new BankingException(ErrorCode.FORBIDDEN);
        }
    }
}

package com.banking.account.util;

import com.banking.account.repository.AccountRepository;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;

/**
 * Generates account numbers of the form {@code ACC} + 10 random digits, e.g. ACC4821930457.
 * Checks the database so the number is unique (the DB unique constraint is the final guard).
 */
@Component
@RequiredArgsConstructor
public class AccountNumberGenerator {

    public static final String PREFIX = "ACC";
    private static final long TEN_DIGITS = 10_000_000_000L;
    private static final int MAX_ATTEMPTS = 10;

    private final SecureRandom random = new SecureRandom();
    private final AccountRepository accountRepository;

    public String generate() {
        for (int attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            String candidate = randomNumber();
            if (!accountRepository.existsByAccountNumber(candidate)) {
                return candidate;
            }
        }
        throw new BankingException(ErrorCode.INTERNAL_ERROR, "Could not generate a unique account number");
    }

    /** One random candidate, not checked against the database. */
    public String randomNumber() {
        return PREFIX + String.format("%010d", random.nextLong(TEN_DIGITS));
    }
}

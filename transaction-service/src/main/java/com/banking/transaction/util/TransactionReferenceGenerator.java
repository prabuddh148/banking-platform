package com.banking.transaction.util;

import com.banking.common.util.DateTimeUtil;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

/**
 * Builds human-friendly transaction references: {@code TXN} + date (yyyyMMdd, IST) + 8 random
 * uppercase letters/digits, e.g. {@code TXN20261121K7Q2M9XA}. Uniqueness is checked by the caller
 * (and enforced by a unique index).
 */
@Component
public class TransactionReferenceGenerator {

    private static final String PREFIX = "TXN";
    private static final String ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final int RANDOM_LENGTH = 8;
    /** yyyyMMdd */
    private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.BASIC_ISO_DATE;

    private final SecureRandom random = new SecureRandom();

    public String generate() {
        StringBuilder sb = new StringBuilder(PREFIX).append(LocalDate.now(DateTimeUtil.IST).format(DATE_FORMAT));
        for (int i = 0; i < RANDOM_LENGTH; i++) {
            sb.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        }
        return sb.toString();
    }
}

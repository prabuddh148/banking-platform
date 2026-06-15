package com.banking.transaction.util;

import com.banking.transaction.repository.TransactionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Random;

@Component
@Slf4j
@RequiredArgsConstructor
public class TransactionReferenceGenerator {

    private final TransactionRepository transactionRepository;
    private final Random random = new Random();

    public String generate() {
        String referenceNumber;
        int attempts = 0;
        do {
            referenceNumber = generateReferenceNumber();
            attempts++;
            if (attempts > 10) {
                throw new IllegalStateException("Unable to generate unique reference number after 10 attempts");
            }
        } while (transactionRepository.existsByReferenceNumber(referenceNumber));

        log.debug("Generated unique reference number: {} in {} attempt(s)", referenceNumber, attempts);
        return referenceNumber;
    }

    private String generateReferenceNumber() {
        long nanoTime = System.nanoTime();
        String nanoSuffix = String.valueOf(Math.abs(nanoTime)).substring(
                Math.max(0, String.valueOf(Math.abs(nanoTime)).length() - 10));
        int randomDigits = 1000 + random.nextInt(9000);
        return "TXN" + nanoSuffix + randomDigits;
    }
}

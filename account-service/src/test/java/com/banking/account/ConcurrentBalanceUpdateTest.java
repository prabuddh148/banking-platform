package com.banking.account;

import com.banking.account.entity.Account;
import com.banking.account.entity.AccountBalance;
import com.banking.account.entity.AccountStatus;
import com.banking.account.entity.AccountType;
import com.banking.account.entity.BalanceUpdateOutcome;
import com.banking.account.event.BalanceUpdateRequestedEvent;
import com.banking.account.mapper.AccountMapperImpl;
import com.banking.account.producer.AccountEventProducer;
import com.banking.account.repository.AccountBalanceRepository;
import com.banking.account.repository.AccountRepository;
import com.banking.account.service.AccountBalanceService;
import com.banking.account.service.AccountBalanceServiceImpl;
import com.banking.account.validation.AccountValidator;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.autoconfigure.jackson.JacksonAutoConfiguration;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Many saga balance updates hitting the same accounts at the same moment, on a real PostgreSQL.
 * <p>
 * Proves the two locking guarantees of {@link AccountBalanceServiceImpl}:
 * <ul>
 *   <li>{@code SELECT ... FOR UPDATE} serialises debits, so the funds check can't be raced and a
 *       balance never goes negative (no double spend, no lost update);</li>
 *   <li>rows are locked in ascending id order, so opposite-direction transfers (A→B and B→A)
 *       can't deadlock.</li>
 * </ul>
 * No test transaction ({@code NOT_SUPPORTED}): every update commits on its own thread, like it
 * would when consumed from Kafka.
 */
@DataJpaTest(properties = {
        "spring.jpa.hibernate.ddl-auto=validate",
        "spring.flyway.enabled=true",
        "spring.datasource.hikari.maximum-pool-size=25"
})
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ImportAutoConfiguration(JacksonAutoConfiguration.class)
@Import({AccountBalanceServiceImpl.class, AccountValidator.class, AccountEventProducer.class, AccountMapperImpl.class})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class ConcurrentBalanceUpdateTest {

    private static final String OWNER = "CUST-CONC";
    private static final int THREADS = 20;

    private static EmbeddedPostgres postgres;

    @Autowired
    private AccountBalanceService balanceService;
    @Autowired
    private AccountRepository accountRepository;
    @Autowired
    private AccountBalanceRepository balanceRepository;

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) throws IOException {
        if (postgres == null) {
            postgres = EmbeddedPostgres.start();
        }
        registry.add("spring.datasource.url", () -> postgres.getJdbcUrl("postgres", "postgres"));
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "");
    }

    @AfterAll
    static void stop() throws IOException {
        if (postgres != null) {
            postgres.close();
        }
    }

    @Test
    void twentyParallelTransfersNeverOverdrawTheSourceAccount() throws Exception {
        // Enough money for exactly 10 of the 20 transfers.
        UUID source = openAccount("1000.00");
        UUID destination = openAccount("0.00");

        List<BalanceUpdateOutcome> outcomes = runConcurrently(THREADS,
                i -> transfer(source, destination, "100.00"));

        assertThat(outcomes).doesNotContainNull();
        assertThat(outcomes).filteredOn(o -> o == BalanceUpdateOutcome.SUCCEEDED).hasSize(10);
        assertThat(outcomes).filteredOn(o -> o == BalanceUpdateOutcome.FAILED).hasSize(10);

        BigDecimal sourceBalance = ledger(source);
        BigDecimal destinationBalance = ledger(destination);
        assertThat(sourceBalance).isGreaterThanOrEqualTo(BigDecimal.ZERO);
        assertThat(sourceBalance).isEqualByComparingTo("0.00");
        assertThat(destinationBalance).isEqualByComparingTo("1000.00");
        assertThat(sourceBalance.add(destinationBalance)).isEqualByComparingTo("1000.00");
    }

    @Test
    void oppositeDirectionTransfersDoNotDeadlockAndKeepTheTotal() throws Exception {
        UUID a = openAccount("500.00");
        UUID b = openAccount("500.00");

        // Even threads send A→B, odd threads send B→A, all at the same moment.
        List<BalanceUpdateOutcome> outcomes = runConcurrently(THREADS,
                i -> i % 2 == 0 ? transfer(a, b, "10.00") : transfer(b, a, "10.00"));

        assertThat(outcomes).hasSize(THREADS).containsOnly(BalanceUpdateOutcome.SUCCEEDED);
        assertThat(ledger(a)).isEqualByComparingTo("500.00");
        assertThat(ledger(b)).isEqualByComparingTo("500.00");
    }

    // ------------------------------------------------------------------ helpers

    private interface Step {
        BalanceUpdateOutcome run(int index) throws Exception;
    }

    /** Starts all tasks behind one latch so they really hit the database together. */
    private static List<BalanceUpdateOutcome> runConcurrently(int threads, Step step) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch ready = new CountDownLatch(threads);
        CountDownLatch go = new CountDownLatch(1);
        try {
            List<Future<BalanceUpdateOutcome>> futures = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                int index = i;
                Callable<BalanceUpdateOutcome> task = () -> {
                    ready.countDown();
                    go.await();
                    return step.run(index);
                };
                futures.add(pool.submit(task));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            go.countDown();
            List<BalanceUpdateOutcome> outcomes = new ArrayList<>();
            for (Future<BalanceUpdateOutcome> f : futures) {
                // A deadlock would surface here as a timeout or a PostgreSQL "deadlock detected" error.
                outcomes.add(f.get(30, TimeUnit.SECONDS));
            }
            return outcomes;
        } finally {
            pool.shutdownNow();
        }
    }

    private BalanceUpdateOutcome transfer(UUID from, UUID to, String amount) {
        BalanceUpdateRequestedEvent event = new BalanceUpdateRequestedEvent();
        event.setTransactionId(UUID.randomUUID().toString());
        event.setTransactionType("TRANSFER");
        event.setSourceAccountId(from.toString());
        event.setDestinationAccountId(to.toString());
        event.setAmount(new BigDecimal(amount));
        event.setCurrency("INR");
        event.setInitiatedBy(OWNER);
        return balanceService.applyBalanceUpdate(event);
    }

    private UUID openAccount(String opening) {
        Account account = Account.builder()
                .accountNumber("ACC" + ThreadLocalRandom.current().nextLong(1_000_000_000L, 9_999_999_999L))
                .customerId(OWNER)
                .customerName("Concurrency Test")
                .customerEmail("concurrency@example.com")
                .accountType(AccountType.SAVINGS)
                .status(AccountStatus.ACTIVE)
                .currency("INR")
                .build();
        account.attachBalance(AccountBalance.builder()
                .ledgerBalance(new BigDecimal(opening))
                .currency("INR")
                .build());
        return accountRepository.saveAndFlush(account).getId();
    }

    private BigDecimal ledger(UUID accountId) {
        return balanceRepository.findById(accountId).orElseThrow().getLedgerBalance();
    }
}

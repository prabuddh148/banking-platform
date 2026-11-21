package com.banking.account;

import com.banking.account.consumer.TransactionCompletedConsumer;
import com.banking.account.dto.request.CreateAccountRequest;
import com.banking.account.dto.request.ReserveBalanceRequest;
import com.banking.account.dto.response.AccountBalanceResponse;
import com.banking.account.dto.response.AccountResponse;
import com.banking.account.entity.Account;
import com.banking.account.entity.AccountBalance;
import com.banking.account.entity.AccountStatus;
import com.banking.account.entity.AccountStatusHistory;
import com.banking.account.entity.AccountType;
import com.banking.account.entity.BalanceReservation;
import com.banking.account.entity.BalanceUpdateOutcome;
import com.banking.account.entity.ProcessedTransaction;
import com.banking.account.entity.ReservationStatus;
import com.banking.account.event.AccountCreatedEvent;
import com.banking.account.event.AccountStatusChangedEvent;
import com.banking.account.event.BalanceUpdateFailedEvent;
import com.banking.account.event.BalanceUpdateRequestedEvent;
import com.banking.account.event.BalanceUpdatedEvent;
import com.banking.account.mapper.AccountMapper;
import com.banking.account.producer.AccountEventProducer;
import com.banking.account.repository.AccountBalanceRepository;
import com.banking.account.repository.AccountRepository;
import com.banking.account.repository.AccountStatusHistoryRepository;
import com.banking.account.repository.BalanceReservationRepository;
import com.banking.account.repository.ProcessedTransactionRepository;
import com.banking.account.service.AccountBalanceService;
import com.banking.account.service.AccountBalanceServiceImpl;
import com.banking.account.service.AccountServiceImpl;
import com.banking.account.util.AccountNumberGenerator;
import com.banking.account.validation.AccountValidator;
import com.banking.common.event.BaseEvent;
import com.banking.common.event.EventType;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.SecurityConstants;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mapstruct.factory.Mappers;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Plain Mockito unit tests (no Spring context, no database, no Kafka) for the account and
 * balance business logic. Repositories and the outbox producer are mocks; the validator and the
 * MapStruct mapper are the real implementations.
 */
@ExtendWith(MockitoExtension.class)
class AccountServiceTest {

    private static final AuthenticatedUser RAHUL = new AuthenticatedUser("CUST-1001", "rahul",
            "rahul.sharma@example.com", "Rahul Sharma", List.of(SecurityConstants.ROLE_CUSTOMER));
    private static final AuthenticatedUser PRIYA = new AuthenticatedUser("CUST-1002", "priya",
            "priya.patel@example.com", "Priya Patel", List.of(SecurityConstants.ROLE_CUSTOMER));
    private static final AuthenticatedUser ADMIN = new AuthenticatedUser("ADMIN-1", "admin",
            "admin@meridian.bank", "Devon Ellis",
            List.of(SecurityConstants.ROLE_ADMIN, SecurityConstants.ROLE_CUSTOMER));

    @Mock
    private AccountRepository accountRepository;
    @Mock
    private AccountBalanceRepository balanceRepository;
    @Mock
    private AccountStatusHistoryRepository historyRepository;
    @Mock
    private BalanceReservationRepository reservationRepository;
    @Mock
    private ProcessedTransactionRepository processedTransactionRepository;
    @Mock
    private AccountNumberGenerator accountNumberGenerator;
    @Mock
    private AccountEventProducer eventProducer;

    private final AccountMapper mapper = Mappers.getMapper(AccountMapper.class);
    private final AccountValidator validator = new AccountValidator();

    private AccountServiceImpl accountService;
    private AccountBalanceServiceImpl balanceService;

    @BeforeEach
    void setUp() {
        accountService = new AccountServiceImpl(accountRepository, balanceRepository, historyRepository,
                accountNumberGenerator, validator, eventProducer, mapper);
        balanceService = new AccountBalanceServiceImpl(balanceRepository, reservationRepository,
                processedTransactionRepository, validator, eventProducer, mapper);
    }

    @AfterEach
    void clearSecurity() {
        SecurityContextHolder.clearContext();
    }

    // ------------------------------------------------------------------ helpers

    private static void loginAs(AuthenticatedUser user) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(user, null,
                user.roles().stream().map(SimpleGrantedAuthority::new).toList()));
    }

    /** Builds an account with its balance (both sides of the relation linked). */
    private static AccountBalance balance(UUID id, String owner, AccountStatus status, String currency,
                                          String ledger) {
        Account account = Account.builder()
                .id(id)
                .accountNumber("ACC" + Math.abs(id.getLeastSignificantBits() % 10_000_000_000L))
                .customerId(owner)
                .customerName("Customer " + owner)
                .customerEmail(owner.toLowerCase() + "@example.com")
                .accountType(AccountType.SAVINGS)
                .status(status)
                .currency(currency)
                .build();
        AccountBalance balance = AccountBalance.builder()
                .accountId(id)
                .ledgerBalance(new BigDecimal(ledger).setScale(2))
                .currency(currency)
                .build();
        account.attachBalance(balance);
        return balance;
    }

    private static BalanceUpdateRequestedEvent request(String type, UUID source, UUID destination, String amount,
                                                       String currency, String initiatedBy) {
        BalanceUpdateRequestedEvent event = new BalanceUpdateRequestedEvent();
        event.setEventId(UUID.randomUUID().toString());
        event.setEventType(EventType.BALANCE_UPDATE_REQUESTED);
        event.setCorrelationId("corr-1");
        event.setTransactionId("txn-" + UUID.randomUUID());
        event.setTransactionType(type);
        event.setSourceAccountId(source == null ? null : source.toString());
        event.setDestinationAccountId(destination == null ? null : destination.toString());
        event.setAmount(new BigDecimal(amount));
        event.setCurrency(currency);
        event.setInitiatedBy(initiatedBy);
        return event;
    }

    private BaseEvent capturePublishedEvent() {
        ArgumentCaptor<BaseEvent> captor = ArgumentCaptor.forClass(BaseEvent.class);
        verify(eventProducer).publish(captor.capture(), anyString());
        return captor.getValue();
    }

    private ProcessedTransaction captureLedgerRow() {
        ArgumentCaptor<ProcessedTransaction> captor = ArgumentCaptor.forClass(ProcessedTransaction.class);
        verify(processedTransactionRepository).save(captor.capture());
        return captor.getValue();
    }

    // ------------------------------------------------------------------ account lifecycle

    @Nested
    @DisplayName("Account lifecycle")
    class AccountLifecycle {

        @BeforeEach
        void saveReturnsEntityWithId() {
            lenient().when(accountRepository.save(any(Account.class))).thenAnswer(inv -> {
                Account a = inv.getArgument(0);
                if (a.getId() == null) {
                    a.setId(UUID.randomUUID());
                }
                return a;
            });
        }

        @Test
        @DisplayName("customer opens an account: own customerId is used, initial deposit becomes the balance")
        void createAccountAsCustomer() {
            loginAs(RAHUL);
            when(accountNumberGenerator.generate()).thenReturn("ACC0000000001");
            CreateAccountRequest request = CreateAccountRequest.builder()
                    .customerName("Rahul Sharma")
                    .customerEmail("rahul.sharma@example.com")
                    .accountType(AccountType.SAVINGS)
                    .initialDeposit(new BigDecimal("5000"))
                    .customerId("CUST-9999") // must be ignored for customers
                    .build();

            AccountResponse response = accountService.createAccount(request);

            assertThat(response.customerId()).isEqualTo("CUST-1001");
            assertThat(response.accountNumber()).isEqualTo("ACC0000000001");
            assertThat(response.currency()).isEqualTo("INR");
            assertThat(response.status()).isEqualTo(AccountStatus.ACTIVE);
            assertThat(response.balance()).isEqualByComparingTo("5000.00");
            assertThat(response.availableBalance()).isEqualByComparingTo("5000.00");

            ArgumentCaptor<AccountStatusHistory> history = ArgumentCaptor.forClass(AccountStatusHistory.class);
            verify(historyRepository).save(history.capture());
            assertThat(history.getValue().getPreviousStatus()).isNull();
            assertThat(history.getValue().getNewStatus()).isEqualTo(AccountStatus.ACTIVE);

            AccountCreatedEvent event = (AccountCreatedEvent) capturePublishedEvent();
            assertThat(event.getEventType()).isEqualTo(EventType.ACCOUNT_CREATED);
            assertThat(event.getAggregateId()).isEqualTo(response.id().toString());
            assertThat(event.getCustomerId()).isEqualTo("CUST-1001");
            assertThat(event.getInitialBalance()).isEqualByComparingTo("5000.00");
        }

        @Test
        @DisplayName("admin can open an account for another customer, in another currency")
        void createAccountAsAdminForOtherCustomer() {
            loginAs(ADMIN);
            when(accountNumberGenerator.generate()).thenReturn("ACC0000000002");
            CreateAccountRequest request = CreateAccountRequest.builder()
                    .customerName("Priya Patel")
                    .customerEmail("priya.patel@example.com")
                    .accountType(AccountType.CURRENT)
                    .currency("usd")
                    .customerId("CUST-1002")
                    .build();

            AccountResponse response = accountService.createAccount(request);

            assertThat(response.customerId()).isEqualTo("CUST-1002");
            assertThat(response.currency()).isEqualTo("USD");
            assertThat(response.balance()).isEqualByComparingTo("0.00");
        }

        @Test
        @DisplayName("a customer cannot read someone else's account")
        void getAccountOfOtherCustomerIsForbidden() {
            loginAs(PRIYA);
            UUID id = UUID.randomUUID();
            Account account = balance(id, "CUST-1001", AccountStatus.ACTIVE, "INR", "100").getAccount();
            when(accountRepository.findWithBalanceById(id)).thenReturn(Optional.of(account));

            assertThatThrownBy(() -> accountService.getAccount(id))
                    .isInstanceOf(BankingException.class)
                    .extracting(e -> ((BankingException) e).getErrorCode())
                    .isEqualTo(ErrorCode.FORBIDDEN);
        }

        @Test
        @DisplayName("unknown account id gives ACCOUNT_NOT_FOUND")
        void getUnknownAccount() {
            loginAs(ADMIN);
            UUID id = UUID.randomUUID();
            when(accountRepository.findWithBalanceById(id)).thenReturn(Optional.empty());

            assertThatThrownBy(() -> accountService.getAccount(id))
                    .isInstanceOf(BankingException.class)
                    .extracting(e -> ((BankingException) e).getErrorCode())
                    .isEqualTo(ErrorCode.ACCOUNT_NOT_FOUND);
        }

        @Test
        @DisplayName("freeze: status changes, history row and ACCOUNT_STATUS_CHANGED are written")
        void freezeAccount() {
            loginAs(ADMIN);
            UUID id = UUID.randomUUID();
            AccountBalance balance = balance(id, "CUST-1001", AccountStatus.ACTIVE, "INR", "100");
            when(balanceRepository.findByIdForUpdate(id)).thenReturn(Optional.of(balance));

            AccountResponse response = accountService.freezeAccount(id, "Suspicious activity");

            assertThat(response.status()).isEqualTo(AccountStatus.FROZEN);
            ArgumentCaptor<AccountStatusHistory> history = ArgumentCaptor.forClass(AccountStatusHistory.class);
            verify(historyRepository).save(history.capture());
            assertThat(history.getValue().getPreviousStatus()).isEqualTo(AccountStatus.ACTIVE);
            assertThat(history.getValue().getNewStatus()).isEqualTo(AccountStatus.FROZEN);
            assertThat(history.getValue().getChangedBy()).isEqualTo("ADMIN-1");

            AccountStatusChangedEvent event = (AccountStatusChangedEvent) capturePublishedEvent();
            assertThat(event.getPreviousStatus()).isEqualTo("ACTIVE");
            assertThat(event.getNewStatus()).isEqualTo("FROZEN");
            assertThat(event.getReason()).isEqualTo("Suspicious activity");
        }

        @Test
        @DisplayName("unfreezing an ACTIVE account is rejected")
        void unfreezeActiveAccountIsConflict() {
            loginAs(ADMIN);
            UUID id = UUID.randomUUID();
            when(balanceRepository.findByIdForUpdate(id))
                    .thenReturn(Optional.of(balance(id, "CUST-1001", AccountStatus.ACTIVE, "INR", "0")));

            assertThatThrownBy(() -> accountService.unfreezeAccount(id, null))
                    .isInstanceOf(BankingException.class)
                    .extracting(e -> ((BankingException) e).getErrorCode())
                    .isEqualTo(ErrorCode.CONFLICT);
            verifyNoInteractions(eventProducer, historyRepository);
        }

        @Test
        @DisplayName("closing an account that still holds money is rejected")
        void closeWithBalanceIsRejected() {
            loginAs(RAHUL);
            UUID id = UUID.randomUUID();
            when(balanceRepository.findByIdForUpdate(id))
                    .thenReturn(Optional.of(balance(id, "CUST-1001", AccountStatus.ACTIVE, "INR", "10")));

            assertThatThrownBy(() -> accountService.closeAccount(id, null))
                    .isInstanceOf(BankingException.class)
                    .extracting(e -> ((BankingException) e).getErrorCode())
                    .isEqualTo(ErrorCode.CONFLICT);
            verify(accountRepository, never()).save(any());
            verifyNoInteractions(eventProducer);
        }

        @Test
        @DisplayName("owner can close an empty account")
        void ownerClosesEmptyAccount() {
            loginAs(RAHUL);
            UUID id = UUID.randomUUID();
            when(balanceRepository.findByIdForUpdate(id))
                    .thenReturn(Optional.of(balance(id, "CUST-1001", AccountStatus.ACTIVE, "INR", "0")));

            AccountResponse response = accountService.closeAccount(id, null);

            assertThat(response.status()).isEqualTo(AccountStatus.CLOSED);
            AccountStatusChangedEvent event = (AccountStatusChangedEvent) capturePublishedEvent();
            assertThat(event.getChangedBy()).isEqualTo("CUST-1001");
            assertThat(event.getReason()).isEqualTo("Closed on request");
        }
    }

    // ------------------------------------------------------------------ balance updates (saga step)

    @Nested
    @DisplayName("BALANCE_UPDATE_REQUESTED handling")
    class BalanceUpdates {

        // Fixed ids so the lock order is predictable: LOW < HIGH.
        private final UUID low = UUID.fromString("00000000-0000-0000-0000-000000000001");
        private final UUID high = UUID.fromString("00000000-0000-0000-0000-000000000002");

        @Test
        @DisplayName("transfer debits source, credits destination, locks in id order, queues BALANCE_UPDATED")
        void successfulTransfer() {
            AccountBalance source = balance(high, "CUST-1001", AccountStatus.ACTIVE, "INR", "1000");
            AccountBalance destination = balance(low, "CUST-1002", AccountStatus.ACTIVE, "INR", "50");
            when(balanceRepository.findByIdForUpdate(high)).thenReturn(Optional.of(source));
            when(balanceRepository.findByIdForUpdate(low)).thenReturn(Optional.of(destination));
            BalanceUpdateRequestedEvent event = request("TRANSFER", high, low, "250.50", "INR", "CUST-1001");

            BalanceUpdateOutcome outcome = balanceService.applyBalanceUpdate(event);

            assertThat(outcome).isEqualTo(BalanceUpdateOutcome.SUCCEEDED);
            assertThat(source.getLedgerBalance()).isEqualByComparingTo("749.50");
            assertThat(destination.getLedgerBalance()).isEqualByComparingTo("300.50");

            // Lower id first, even though it is the destination.
            InOrder order = inOrder(balanceRepository);
            order.verify(balanceRepository).findByIdForUpdate(low);
            order.verify(balanceRepository).findByIdForUpdate(high);

            ProcessedTransaction ledger = captureLedgerRow();
            assertThat(ledger.getTransactionId()).isEqualTo(event.getTransactionId());
            assertThat(ledger.getOutcome()).isEqualTo(BalanceUpdateOutcome.SUCCEEDED);

            BalanceUpdatedEvent published = (BalanceUpdatedEvent) capturePublishedEvent();
            assertThat(published.getEventType()).isEqualTo(EventType.BALANCE_UPDATED);
            assertThat(published.getAggregateId()).isEqualTo(event.getTransactionId());
            assertThat(published.getCorrelationId()).isEqualTo("corr-1");
            assertThat(published.getSourceBalanceAfter()).isEqualByComparingTo("749.50");
            assertThat(published.getDestinationBalanceAfter()).isEqualByComparingTo("300.50");
        }

        @Test
        @DisplayName("withdrawal with insufficient funds: no balance change, BALANCE_UPDATE_FAILED(INSUFFICIENT_FUNDS)")
        void insufficientFunds() {
            AccountBalance source = balance(low, "CUST-1001", AccountStatus.ACTIVE, "INR", "100");
            when(balanceRepository.findByIdForUpdate(low)).thenReturn(Optional.of(source));
            when(reservationRepository.findByAccountIdAndTransactionIdAndStatus(eq(low), anyString(),
                    eq(ReservationStatus.ACTIVE))).thenReturn(Optional.empty());
            BalanceUpdateRequestedEvent event = request("WITHDRAWAL", low, null, "100.01", "INR", "CUST-1001");

            BalanceUpdateOutcome outcome = balanceService.applyBalanceUpdate(event);

            assertThat(outcome).isEqualTo(BalanceUpdateOutcome.FAILED);
            assertThat(source.getLedgerBalance()).isEqualByComparingTo("100.00");
            verify(balanceRepository, never()).save(any());

            ProcessedTransaction ledger = captureLedgerRow();
            assertThat(ledger.getOutcome()).isEqualTo(BalanceUpdateOutcome.FAILED);
            assertThat(ledger.getErrorCode()).isEqualTo("INSUFFICIENT_FUNDS");

            BalanceUpdateFailedEvent failed = (BalanceUpdateFailedEvent) capturePublishedEvent();
            assertThat(failed.getEventType()).isEqualTo(EventType.BALANCE_UPDATE_FAILED);
            assertThat(failed.getErrorCode()).isEqualTo("INSUFFICIENT_FUNDS");
            assertThat(failed.getTransactionId()).isEqualTo(event.getTransactionId());
        }

        @Test
        @DisplayName("transfer into a frozen account fails with ACCOUNT_FROZEN and the source is NOT debited")
        void frozenDestination() {
            AccountBalance source = balance(low, "CUST-1001", AccountStatus.ACTIVE, "INR", "1000");
            AccountBalance destination = balance(high, "CUST-1002", AccountStatus.FROZEN, "INR", "0");
            when(balanceRepository.findByIdForUpdate(low)).thenReturn(Optional.of(source));
            when(balanceRepository.findByIdForUpdate(high)).thenReturn(Optional.of(destination));
            when(reservationRepository.findByAccountIdAndTransactionIdAndStatus(eq(low), anyString(),
                    eq(ReservationStatus.ACTIVE))).thenReturn(Optional.empty());

            BalanceUpdateOutcome outcome = balanceService.applyBalanceUpdate(
                    request("TRANSFER", low, high, "10", "INR", "CUST-1001"));

            assertThat(outcome).isEqualTo(BalanceUpdateOutcome.FAILED);
            assertThat(source.getLedgerBalance()).isEqualByComparingTo("1000.00");
            assertThat(destination.getLedgerBalance()).isEqualByComparingTo("0.00");
            assertThat(((BalanceUpdateFailedEvent) capturePublishedEvent()).getErrorCode()).isEqualTo("ACCOUNT_FROZEN");
        }

        @Test
        @DisplayName("debit from an account the initiator does not own fails with FORBIDDEN")
        void notOwner() {
            when(balanceRepository.findByIdForUpdate(low))
                    .thenReturn(Optional.of(balance(low, "CUST-1001", AccountStatus.ACTIVE, "INR", "1000")));

            balanceService.applyBalanceUpdate(request("WITHDRAWAL", low, null, "10", "INR", "CUST-1002"));

            assertThat(((BalanceUpdateFailedEvent) capturePublishedEvent()).getErrorCode()).isEqualTo("FORBIDDEN");
        }

        @Test
        @DisplayName("deposit in the wrong currency fails with CURRENCY_MISMATCH")
        void currencyMismatch() {
            AccountBalance destination = balance(low, "CUST-1001", AccountStatus.ACTIVE, "INR", "0");
            when(balanceRepository.findByIdForUpdate(low)).thenReturn(Optional.of(destination));

            balanceService.applyBalanceUpdate(request("DEPOSIT", null, low, "10", "USD", "CUST-1001"));

            assertThat(destination.getLedgerBalance()).isEqualByComparingTo("0.00");
            assertThat(((BalanceUpdateFailedEvent) capturePublishedEvent()).getErrorCode())
                    .isEqualTo("CURRENCY_MISMATCH");
        }

        @Test
        @DisplayName("unknown account fails with ACCOUNT_NOT_FOUND")
        void unknownAccount() {
            when(balanceRepository.findByIdForUpdate(low)).thenReturn(Optional.empty());

            balanceService.applyBalanceUpdate(request("DEPOSIT", null, low, "10", "INR", "CUST-1001"));

            assertThat(((BalanceUpdateFailedEvent) capturePublishedEvent()).getErrorCode())
                    .isEqualTo("ACCOUNT_NOT_FOUND");
        }

        @Test
        @DisplayName("re-delivered transaction is skipped: no locks, no balance change, no new event")
        void idempotentRedelivery() {
            BalanceUpdateRequestedEvent event = request("DEPOSIT", null, low, "10", "INR", "CUST-1001");
            when(processedTransactionRepository.existsById(event.getTransactionId())).thenReturn(true);

            BalanceUpdateOutcome outcome = balanceService.applyBalanceUpdate(event);

            assertThat(outcome).isNull();
            verifyNoInteractions(balanceRepository, eventProducer);
            verify(processedTransactionRepository, never()).save(any());
        }

        @Test
        @DisplayName("withdrawal consumes an active reservation made for the same transaction")
        void withdrawalConsumesReservation() {
            AccountBalance source = balance(low, "CUST-1001", AccountStatus.ACTIVE, "INR", "100");
            source.setReservedAmount(new BigDecimal("80.00")); // available = 20
            BalanceUpdateRequestedEvent event = request("WITHDRAWAL", low, null, "80", "INR", "CUST-1001");
            BalanceReservation hold = BalanceReservation.builder().accountId(low)
                    .transactionId(event.getTransactionId()).amount(new BigDecimal("80.00")).build();
            when(balanceRepository.findByIdForUpdate(low)).thenReturn(Optional.of(source));
            when(reservationRepository.findByAccountIdAndTransactionIdAndStatus(low, event.getTransactionId(),
                    ReservationStatus.ACTIVE)).thenReturn(Optional.of(hold));

            BalanceUpdateOutcome outcome = balanceService.applyBalanceUpdate(event);

            assertThat(outcome).isEqualTo(BalanceUpdateOutcome.SUCCEEDED);
            assertThat(source.getLedgerBalance()).isEqualByComparingTo("20.00");
            assertThat(source.getReservedAmount()).isEqualByComparingTo("0.00");
            assertThat(hold.getStatus()).isEqualTo(ReservationStatus.CONSUMED);
        }
    }

    // ------------------------------------------------------------------ reserve / release (REST)

    @Nested
    @DisplayName("Reserve and release")
    class ReserveRelease {

        private final UUID id = UUID.randomUUID();

        @Test
        @DisplayName("reserve lowers the available balance but not the ledger balance")
        void reserve() {
            AccountBalance balance = balance(id, "CUST-1001", AccountStatus.ACTIVE, "INR", "500");
            when(balanceRepository.findByIdForUpdate(id)).thenReturn(Optional.of(balance));
            when(reservationRepository.findByAccountIdAndTransactionId(id, "txn-1")).thenReturn(Optional.empty());

            AccountBalanceResponse response = balanceService.reserve(id,
                    new ReserveBalanceRequest(new BigDecimal("200"), "txn-1"));

            assertThat(response.ledgerBalance()).isEqualByComparingTo("500.00");
            assertThat(response.reservedAmount()).isEqualByComparingTo("200.00");
            assertThat(response.availableBalance()).isEqualByComparingTo("300.00");
            verify(reservationRepository).save(any(BalanceReservation.class));
        }

        @Test
        @DisplayName("reserving more than is available fails with INSUFFICIENT_FUNDS")
        void reserveTooMuch() {
            AccountBalance balance = balance(id, "CUST-1001", AccountStatus.ACTIVE, "INR", "100");
            when(balanceRepository.findByIdForUpdate(id)).thenReturn(Optional.of(balance));
            when(reservationRepository.findByAccountIdAndTransactionId(id, "txn-1")).thenReturn(Optional.empty());

            assertThatThrownBy(() -> balanceService.reserve(id,
                    new ReserveBalanceRequest(new BigDecimal("100.01"), "txn-1")))
                    .isInstanceOf(BankingException.class)
                    .extracting(e -> ((BankingException) e).getErrorCode())
                    .isEqualTo(ErrorCode.INSUFFICIENT_FUNDS);
            assertThat(balance.getReservedAmount()).isEqualByComparingTo("0.00");
        }

        @Test
        @DisplayName("reserving on a frozen account fails with ACCOUNT_FROZEN")
        void reserveOnFrozen() {
            when(balanceRepository.findByIdForUpdate(id))
                    .thenReturn(Optional.of(balance(id, "CUST-1001", AccountStatus.FROZEN, "INR", "100")));

            assertThatThrownBy(() -> balanceService.reserve(id,
                    new ReserveBalanceRequest(new BigDecimal("1"), "txn-1")))
                    .isInstanceOf(BankingException.class)
                    .extracting(e -> ((BankingException) e).getErrorCode())
                    .isEqualTo(ErrorCode.ACCOUNT_FROZEN);
        }

        @Test
        @DisplayName("release gives the held money back")
        void release() {
            AccountBalance balance = balance(id, "CUST-1001", AccountStatus.ACTIVE, "INR", "500");
            balance.setReservedAmount(new BigDecimal("200.00"));
            BalanceReservation hold = BalanceReservation.builder().accountId(id).transactionId("txn-1")
                    .amount(new BigDecimal("200.00")).build();
            when(balanceRepository.findByIdForUpdate(id)).thenReturn(Optional.of(balance));
            when(reservationRepository.findByAccountIdAndTransactionIdAndStatus(id, "txn-1",
                    ReservationStatus.ACTIVE)).thenReturn(Optional.of(hold));

            AccountBalanceResponse response = balanceService.release(id,
                    new ReserveBalanceRequest(new BigDecimal("200"), "txn-1"));

            assertThat(response.availableBalance()).isEqualByComparingTo("500.00");
            assertThat(hold.getStatus()).isEqualTo(ReservationStatus.RELEASED);
        }
    }

    // ------------------------------------------------------------------ Kafka consumer dispatch

    @Nested
    @DisplayName("Transaction events consumer")
    class ConsumerDispatch {

        private final ObjectMapper objectMapper = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        private final AccountBalanceService service = mock(AccountBalanceService.class);
        private final TransactionCompletedConsumer consumer = new TransactionCompletedConsumer(objectMapper, service);

        @Test
        @DisplayName("BALANCE_UPDATE_REQUESTED is parsed (unknown fields ignored) and handed to the service")
        void dispatchesBalanceUpdateRequested() throws Exception {
            String json = """
                    {"eventId":"e-1","eventType":"BALANCE_UPDATE_REQUESTED","aggregateId":"txn-9",
                     "occurredAt":"2026-01-01T10:00:00Z","correlationId":"c-9","source":"transaction-service",
                     "schemaVersion":1,"transactionId":"txn-9","reference":"TXN20260101ABCDEFGH",
                     "transactionType":"DEPOSIT","sourceAccountId":null,
                     "destinationAccountId":"00000000-0000-0000-0000-000000000001",
                     "amount":125.75,"currency":"INR","initiatedBy":"CUST-1001","someNewField":"ignored"}
                    """;

            consumer.handle(json);

            ArgumentCaptor<BalanceUpdateRequestedEvent> captor =
                    ArgumentCaptor.forClass(BalanceUpdateRequestedEvent.class);
            verify(service).applyBalanceUpdate(captor.capture());
            assertThat(captor.getValue().getTransactionId()).isEqualTo("txn-9");
            assertThat(captor.getValue().getAmount()).isEqualByComparingTo("125.75");
            assertThat(captor.getValue().getCorrelationId()).isEqualTo("c-9");
        }

        @Test
        @DisplayName("other transaction event types are ignored")
        void ignoresOtherEvents() throws Exception {
            consumer.handle("{\"eventType\":\"TRANSACTION_INITIATED\",\"transactionId\":\"txn-1\"}");

            verifyNoInteractions(service);
        }
    }
}

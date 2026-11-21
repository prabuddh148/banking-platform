package com.banking.transaction;

import com.banking.common.dto.PagedResponse;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.SecurityConstants;
import com.banking.transaction.dto.request.DepositRequest;
import com.banking.transaction.dto.request.TransferRequest;
import com.banking.transaction.dto.response.TransactionResponse;
import com.banking.transaction.dto.response.TransactionStatusResponse;
import com.banking.transaction.entity.Transaction;
import com.banking.transaction.entity.TransactionStatus;
import com.banking.transaction.entity.TransactionStatusHistory;
import com.banking.transaction.entity.TransactionType;
import com.banking.transaction.exception.TransactionNotFoundException;
import com.banking.transaction.mapper.TransactionMapper;
import com.banking.transaction.repository.SagaStateRepository;
import com.banking.transaction.repository.TransactionRepository;
import com.banking.transaction.repository.TransactionStatusHistoryRepository;
import com.banking.transaction.saga.TransactionSagaOrchestrator;
import com.banking.transaction.service.TransactionServiceImpl;
import com.banking.transaction.util.TransactionReferenceGenerator;
import com.banking.transaction.validation.TransactionValidator;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mapstruct.factory.Mappers;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link TransactionServiceImpl}: creation, idempotency, validation and access rules.
 * The orchestrator and repositories are mocked; the validator and MapStruct mapper are real.
 */
@ExtendWith(MockitoExtension.class)
class TransactionServiceTest {

    private static final String CUSTOMER_ID = "CUST-1001";

    @Mock
    private TransactionRepository transactionRepository;
    @Mock
    private TransactionStatusHistoryRepository historyRepository;
    @Mock
    private SagaStateRepository sagaStateRepository;
    @Mock
    private TransactionSagaOrchestrator sagaOrchestrator;
    @Mock
    private TransactionReferenceGenerator referenceGenerator;

    private final TransactionMapper mapper = Mappers.getMapper(TransactionMapper.class);
    private TransactionServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new TransactionServiceImpl(transactionRepository, historyRepository, sagaStateRepository,
                sagaOrchestrator, new TransactionValidator(), referenceGenerator, mapper);
        loginAs(CUSTOMER_ID, SecurityConstants.ROLE_CUSTOMER);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    // ------------------------------------------------------------------ create

    @Test
    @DisplayName("deposit builds a PENDING transaction and starts the saga")
    void depositStartsSaga() {
        givenReferenceAndSagaStart();

        TransactionResponse response = service.deposit(
                new DepositRequest("acc-1", new BigDecimal("1500"), null, " Salary "), null, "in");

        ArgumentCaptor<Transaction> captor = ArgumentCaptor.forClass(Transaction.class);
        verify(sagaOrchestrator).startSaga(captor.capture());
        Transaction tx = captor.getValue();
        assertThat(tx.getId()).isNotNull();
        assertThat(tx.getTransactionType()).isEqualTo(TransactionType.DEPOSIT);
        assertThat(tx.getSourceAccountId()).isNull();
        assertThat(tx.getDestinationAccountId()).isEqualTo("acc-1");
        assertThat(tx.getAmount()).isEqualByComparingTo("1500.00");
        assertThat(tx.getAmount().scale()).isEqualTo(2);
        assertThat(tx.getCurrency()).isEqualTo("INR");
        assertThat(tx.getDescription()).isEqualTo("Salary");
        assertThat(tx.getInitiatedBy()).isEqualTo(CUSTOMER_ID);
        assertThat(tx.getClientCountry()).isEqualTo("IN");
        assertThat(tx.getCorrelationId()).isNotBlank();

        assertThat(response.status()).isEqualTo(TransactionStatus.PENDING);
        assertThat(response.reference()).isEqualTo("TXN20261121AAAA1111");
    }

    @Test
    @DisplayName("withdraw uses the account as source")
    void withdrawUsesSource() {
        givenReferenceAndSagaStart();

        service.withdraw(new DepositRequest("acc-1", new BigDecimal("200.50"), "usd", null), null, null);

        ArgumentCaptor<Transaction> captor = ArgumentCaptor.forClass(Transaction.class);
        verify(sagaOrchestrator).startSaga(captor.capture());
        assertThat(captor.getValue().getTransactionType()).isEqualTo(TransactionType.WITHDRAWAL);
        assertThat(captor.getValue().getSourceAccountId()).isEqualTo("acc-1");
        assertThat(captor.getValue().getDestinationAccountId()).isNull();
        assertThat(captor.getValue().getCurrency()).isEqualTo("USD");
    }

    @Test
    @DisplayName("transfer with the same Idempotency-Key returns the existing transaction without a new saga")
    void idempotencyKeyReturnsExisting() {
        Transaction existing = sampleTransaction(CUSTOMER_ID);
        existing.setIdempotencyKey("key-1");
        when(transactionRepository.findByInitiatedByAndIdempotencyKey(CUSTOMER_ID, "key-1"))
                .thenReturn(Optional.of(existing));

        TransactionResponse response = service.transfer(
                new TransferRequest("acc-1", "acc-2", new BigDecimal("10"), "INR", null), "key-1", null);

        assertThat(response.id()).isEqualTo(existing.getId());
        verify(sagaOrchestrator, never()).startSaga(any());
    }

    @Test
    @DisplayName("new Idempotency-Key is stored on the transaction")
    void newIdempotencyKeyIsStored() {
        givenReferenceAndSagaStart();
        when(transactionRepository.findByInitiatedByAndIdempotencyKey(CUSTOMER_ID, "key-2")).thenReturn(Optional.empty());

        service.transfer(new TransferRequest("acc-1", "acc-2", new BigDecimal("10"), null, null), "key-2", null);

        ArgumentCaptor<Transaction> captor = ArgumentCaptor.forClass(Transaction.class);
        verify(sagaOrchestrator).startSaga(captor.capture());
        assertThat(captor.getValue().getIdempotencyKey()).isEqualTo("key-2");
        assertThat(captor.getValue().getTransactionType()).isEqualTo(TransactionType.TRANSFER);
    }

    @Test
    @DisplayName("transfer to the same account is rejected")
    void transferToSameAccountRejected() {
        assertThatThrownBy(() -> service.transfer(
                new TransferRequest("acc-1", "acc-1", new BigDecimal("10"), null, null), null, null))
                .isInstanceOf(BankingException.class)
                .extracting(e -> ((BankingException) e).getErrorCode())
                .isEqualTo(ErrorCode.INVALID_TRANSACTION);
        verify(sagaOrchestrator, never()).startSaga(any());
    }

    @Test
    @DisplayName("amount above 10,000,000 and unsupported currency are rejected")
    void invalidAmountAndCurrency() {
        assertThatThrownBy(() -> service.deposit(
                new DepositRequest("acc-1", new BigDecimal("10000000.01"), null, null), null, null))
                .isInstanceOf(BankingException.class);
        assertThatThrownBy(() -> service.deposit(
                new DepositRequest("acc-1", new BigDecimal("10"), "JPY", null), null, null))
                .isInstanceOf(BankingException.class);
        verify(sagaOrchestrator, never()).startSaga(any());
    }

    @Test
    @DisplayName("creating a transaction without a logged-in user fails with UNAUTHORIZED")
    void requiresUser() {
        SecurityContextHolder.clearContext();
        assertThatThrownBy(() -> service.deposit(
                new DepositRequest("acc-1", BigDecimal.TEN, null, null), null, null))
                .isInstanceOf(BankingException.class)
                .extracting(e -> ((BankingException) e).getErrorCode())
                .isEqualTo(ErrorCode.UNAUTHORIZED);
    }

    // ------------------------------------------------------------------ read

    @Test
    @DisplayName("owner can read their transaction")
    void ownerCanRead() {
        Transaction tx = sampleTransaction(CUSTOMER_ID);
        when(transactionRepository.findById(tx.getId())).thenReturn(Optional.of(tx));

        assertThat(service.getTransaction(tx.getId()).reference()).isEqualTo(tx.getReference());
    }

    @Test
    @DisplayName("another customer gets FORBIDDEN, an admin may read it")
    void otherCustomerForbiddenAdminAllowed() {
        Transaction tx = sampleTransaction("CUST-1002");
        when(transactionRepository.findById(tx.getId())).thenReturn(Optional.of(tx));

        assertThatThrownBy(() -> service.getTransaction(tx.getId()))
                .isInstanceOf(BankingException.class)
                .extracting(e -> ((BankingException) e).getErrorCode())
                .isEqualTo(ErrorCode.FORBIDDEN);

        loginAs("ADMIN-1", SecurityConstants.ROLE_ADMIN, SecurityConstants.ROLE_CUSTOMER);
        assertThat(service.getTransaction(tx.getId()).id()).isEqualTo(tx.getId());
    }

    @Test
    @DisplayName("unknown id -> TransactionNotFoundException")
    void notFound() {
        UUID id = UUID.randomUUID();
        when(transactionRepository.findById(id)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getTransaction(id)).isInstanceOf(TransactionNotFoundException.class);
    }

    @Test
    @DisplayName("status endpoint returns history in order")
    void statusWithHistory() {
        Transaction tx = sampleTransaction(CUSTOMER_ID);
        tx.setStatus(TransactionStatus.PROCESSING);
        when(transactionRepository.findById(tx.getId())).thenReturn(Optional.of(tx));
        when(historyRepository.findByTransactionIdOrderByChangedAtAscIdAsc(tx.getId())).thenReturn(List.of(
                history(tx.getId(), null, TransactionStatus.PENDING),
                history(tx.getId(), TransactionStatus.PENDING, TransactionStatus.PROCESSING)));

        TransactionStatusResponse status = service.getTransactionStatus(tx.getId());

        assertThat(status.status()).isEqualTo(TransactionStatus.PROCESSING);
        assertThat(status.history()).hasSize(2);
        assertThat(status.history().get(1).fromStatus()).isEqualTo(TransactionStatus.PENDING);
    }

    @Test
    @DisplayName("list clamps the page size to 100")
    @SuppressWarnings("unchecked")
    void listClampsPageSize() {
        Transaction tx = sampleTransaction(CUSTOMER_ID);
        when(transactionRepository.findAll(any(Specification.class), any(Pageable.class)))
                .thenAnswer(inv -> new PageImpl<>(List.of(tx), inv.getArgument(1), 1));

        PagedResponse<TransactionResponse> page = service.listTransactions(null, null, null, 0, 500);

        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(transactionRepository).findAll(any(Specification.class), pageable.capture());
        assertThat(pageable.getValue().getPageSize()).isEqualTo(100);
        assertThat(page.getContent()).hasSize(1);
        assertThat(page.getTotalElements()).isEqualTo(1);
    }

    // ------------------------------------------------------------------ helpers

    private void givenReferenceAndSagaStart() {
        when(referenceGenerator.generate()).thenReturn("TXN20261121AAAA1111");
        when(transactionRepository.existsByReference(anyString())).thenReturn(false);
        when(sagaOrchestrator.startSaga(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    private static void loginAs(String userId, String... roles) {
        AuthenticatedUser user = new AuthenticatedUser(userId, userId.toLowerCase(), null, null, List.of(roles));
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(user, null,
                List.of(roles).stream().map(SimpleGrantedAuthority::new).toList()));
    }

    private static Transaction sampleTransaction(String initiatedBy) {
        return Transaction.builder()
                .id(UUID.randomUUID())
                .reference("TXN20261121ZZZZ9999")
                .transactionType(TransactionType.TRANSFER)
                .status(TransactionStatus.PENDING)
                .sourceAccountId("acc-1")
                .destinationAccountId("acc-2")
                .amount(new BigDecimal("10.00"))
                .currency("INR")
                .initiatedBy(initiatedBy)
                .correlationId(UUID.randomUUID().toString())
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build();
    }

    private static TransactionStatusHistory history(UUID txId, TransactionStatus from, TransactionStatus to) {
        return TransactionStatusHistory.builder()
                .transactionId(txId).fromStatus(from).toStatus(to).reason("test").changedAt(Instant.now()).build();
    }
}

package com.banking.transaction;

import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.JwtUtil;
import com.banking.common.security.SecurityConstants;
import com.banking.transaction.config.SecurityConfig;
import com.banking.transaction.controller.TransactionController;
import com.banking.transaction.controller.TransactionStatusController;
import com.banking.transaction.dto.request.DepositRequest;
import com.banking.transaction.dto.response.SagaStateResponse;
import com.banking.transaction.dto.response.TransactionResponse;
import com.banking.transaction.entity.SagaStatus;
import com.banking.transaction.entity.TransactionStatus;
import com.banking.transaction.entity.TransactionType;
import com.banking.transaction.saga.SagaStep;
import com.banking.transaction.security.JwtTokenValidator;
import com.banking.transaction.service.TransactionService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Web-layer tests: request mapping, validation, JSON shape and security (real JWT filter +
 * SecurityConfig). The service is a mock, so no database or Kafka is involved.
 */
@WebMvcTest(controllers = {TransactionController.class, TransactionStatusController.class})
@Import({SecurityConfig.class, JwtTokenValidator.class})
class TransactionControllerTest {

    private static final String BASE = "/api/v1/transactions";

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private TransactionService transactionService;

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Test
    @DisplayName("POST /deposit returns 202 with the PENDING transaction and passes the headers on")
    void depositAccepted() throws Exception {
        TransactionResponse response = sampleResponse(TransactionType.DEPOSIT);
        when(transactionService.deposit(any(DepositRequest.class), eq("idem-1"), eq("IN"))).thenReturn(response);

        mockMvc.perform(post(BASE + "/deposit")
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(customer()))
                        .header(SecurityConstants.HEADER_IDEMPOTENCY_KEY, "idem-1")
                        .header(SecurityConstants.HEADER_CLIENT_COUNTRY, "IN")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":\"acc-1\",\"amount\":1500.00,\"description\":\"Salary\"}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.data.id").value(response.id().toString()))
                .andExpect(jsonPath("$.data.status").value("PENDING"))
                .andExpect(jsonPath("$.data.transactionType").value("DEPOSIT"))
                .andExpect(jsonPath("$.data.amount").value(1500.00));
    }

    @Test
    @DisplayName("POST /transfer with the same source and destination -> 400 VALIDATION_ERROR")
    void transferSameAccountRejected() throws Exception {
        mockMvc.perform(post(BASE + "/transfer")
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(customer()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceAccountId\":\"acc-1\",\"destinationAccountId\":\"acc-1\",\"amount\":10}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
        verify(transactionService, never()).transfer(any(), any(), any());
    }

    @Test
    @DisplayName("POST /withdraw with amount 0 and unsupported currency -> 400 with field details")
    void withdrawInvalidBody() throws Exception {
        mockMvc.perform(post(BASE + "/withdraw")
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(customer()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":\"acc-1\",\"amount\":0,\"currency\":\"JPY\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.error.details.amount").exists())
                .andExpect(jsonPath("$.error.details.currency").exists());
    }

    @Test
    @DisplayName("no token -> 401 UNAUTHORIZED")
    void noTokenUnauthorized() throws Exception {
        mockMvc.perform(post(BASE + "/deposit")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":\"acc-1\",\"amount\":10}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
    }

    @Test
    @DisplayName("garbage token -> 401 INVALID_TOKEN")
    void invalidToken() throws Exception {
        mockMvc.perform(get(BASE + "/" + UUID.randomUUID())
                        .header(SecurityConstants.AUTHORIZATION_HEADER, "Bearer not.a.jwt"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("INVALID_TOKEN"));
    }

    @Test
    @DisplayName("GET /{id} returns the transaction")
    void getById() throws Exception {
        TransactionResponse response = sampleResponse(TransactionType.TRANSFER);
        when(transactionService.getTransaction(response.id())).thenReturn(response);

        mockMvc.perform(get(BASE + "/" + response.id())
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(customer())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.reference").value(response.reference()));
    }

    @Test
    @DisplayName("GET /{id}/saga is admin-only: customer 403, admin 200")
    void sagaAdminOnly() throws Exception {
        UUID txId = UUID.randomUUID();
        when(transactionService.getSagaState(txId)).thenReturn(SagaStateResponse.builder()
                .sagaId(UUID.randomUUID()).transactionId(txId)
                .status(SagaStatus.AWAITING_FRAUD_CHECK).currentStep(SagaStep.FRAUD_CHECK)
                .startedAt(Instant.now()).updatedAt(Instant.now()).build());

        mockMvc.perform(get(BASE + "/" + txId + "/saga")
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(customer())))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));

        mockMvc.perform(get(BASE + "/" + txId + "/saga")
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(admin())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("AWAITING_FRAUD_CHECK"))
                .andExpect(jsonPath("$.data.currentStep").value("FRAUD_CHECK"));
    }

    // ------------------------------------------------------------------ helpers

    private String bearer(AuthenticatedUser user) {
        return SecurityConstants.BEARER_PREFIX + new JwtUtil(jwtSecret, Duration.ofMinutes(5)).generateToken(user);
    }

    private static AuthenticatedUser customer() {
        return new AuthenticatedUser("CUST-1001", "rahul", "rahul.sharma@example.com", "Rahul Sharma",
                List.of(SecurityConstants.ROLE_CUSTOMER));
    }

    private static AuthenticatedUser admin() {
        return new AuthenticatedUser("ADMIN-1", "admin", "admin@meridian.bank", "Devon Ellis",
                List.of(SecurityConstants.ROLE_ADMIN, SecurityConstants.ROLE_CUSTOMER));
    }

    private static TransactionResponse sampleResponse(TransactionType type) {
        return TransactionResponse.builder()
                .id(UUID.randomUUID())
                .reference("TXN20261121ABCD1234")
                .transactionType(type)
                .status(TransactionStatus.PENDING)
                .destinationAccountId("acc-1")
                .amount(new BigDecimal("1500.00"))
                .currency("INR")
                .initiatedBy("CUST-1001")
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build();
    }
}

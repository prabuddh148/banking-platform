package com.banking.account;

import com.banking.account.config.SecurityConfig;
import com.banking.account.controller.AccountController;
import com.banking.account.dto.request.CreateAccountRequest;
import com.banking.account.dto.response.AccountResponse;
import com.banking.account.dto.response.AccountSummaryResponse;
import com.banking.account.entity.AccountStatus;
import com.banking.account.entity.AccountType;
import com.banking.account.exception.AccountNotFoundException;
import com.banking.account.security.JwtTokenValidator;
import com.banking.account.service.AccountService;
import com.banking.common.dto.PagedResponse;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.SecurityConstants;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.data.domain.Pageable;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Web-layer test for {@link AccountController}: only MVC + our real security setup
 * ({@link SecurityConfig} + JwtAuthenticationFilter) are started. The service is a mock and the
 * token validator is a mock that maps fixed fake tokens to users, so no real JWTs, database or
 * Kafka are needed.
 */
@WebMvcTest(controllers = AccountController.class)
@Import(SecurityConfig.class)
class AccountControllerTest {

    private static final String CUSTOMER_TOKEN = "customer-token";
    private static final String ADMIN_TOKEN = "admin-token";
    private static final String BAD_TOKEN = "bad-token";

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private AccountService accountService;
    @MockBean
    private JwtTokenValidator jwtTokenValidator;

    @BeforeEach
    void tokens() {
        when(jwtTokenValidator.validate(CUSTOMER_TOKEN)).thenReturn(new AuthenticatedUser("CUST-1001", "rahul",
                "rahul.sharma@example.com", "Rahul Sharma", List.of(SecurityConstants.ROLE_CUSTOMER)));
        when(jwtTokenValidator.validate(ADMIN_TOKEN)).thenReturn(new AuthenticatedUser("ADMIN-1", "admin",
                "admin@meridian.bank", "Devon Ellis",
                List.of(SecurityConstants.ROLE_ADMIN, SecurityConstants.ROLE_CUSTOMER)));
        when(jwtTokenValidator.validate(BAD_TOKEN)).thenThrow(new BankingException(ErrorCode.TOKEN_EXPIRED));
    }

    private static String bearer(String token) {
        return SecurityConstants.BEARER_PREFIX + token;
    }

    private static AccountResponse sampleAccount(UUID id, AccountStatus status) {
        return new AccountResponse(id, "ACC1234567890", "CUST-1001", "Rahul Sharma", "rahul.sharma@example.com",
                null, AccountType.SAVINGS, status, "INR", new BigDecimal("5000.00"), new BigDecimal("5000.00"),
                Instant.parse("2026-01-01T10:00:00Z"), Instant.parse("2026-01-01T10:00:00Z"));
    }

    @Test
    @DisplayName("POST /accounts as customer -> 201 with the created account")
    void createAccount() throws Exception {
        UUID id = UUID.randomUUID();
        when(accountService.createAccount(any(CreateAccountRequest.class)))
                .thenReturn(sampleAccount(id, AccountStatus.ACTIVE));
        CreateAccountRequest body = CreateAccountRequest.builder()
                .customerName("Rahul Sharma")
                .customerEmail("rahul.sharma@example.com")
                .accountType(AccountType.SAVINGS)
                .initialDeposit(new BigDecimal("5000"))
                .build();

        mockMvc.perform(post("/api/v1/accounts")
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(CUSTOMER_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(id.toString()))
                .andExpect(jsonPath("$.data.accountNumber").value("ACC1234567890"))
                .andExpect(jsonPath("$.data.balance").value(5000.00))
                .andExpect(jsonPath("$.data.createdAt").value("2026-01-01T10:00:00Z"));
    }

    @Test
    @DisplayName("POST /accounts with invalid body -> 400 VALIDATION_ERROR with field details")
    void createAccountValidation() throws Exception {
        String body = """
                {"customerName":"", "customerEmail":"not-an-email", "accountType":"SAVINGS",
                 "currency":"JPY", "initialDeposit":-1}
                """;

        mockMvc.perform(post("/api/v1/accounts")
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(CUSTOMER_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.error.details.customerName").exists())
                .andExpect(jsonPath("$.error.details.customerEmail").exists())
                .andExpect(jsonPath("$.error.details.currency").exists())
                .andExpect(jsonPath("$.error.details.initialDeposit").exists());
        verifyNoInteractions(accountService);
    }

    @Test
    @DisplayName("no token -> 401 UNAUTHORIZED as JSON")
    void noToken() throws Exception {
        mockMvc.perform(get("/api/v1/accounts/{id}", UUID.randomUUID()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
        verifyNoInteractions(accountService);
    }

    @Test
    @DisplayName("expired token -> 401 TOKEN_EXPIRED as JSON")
    void expiredToken() throws Exception {
        mockMvc.perform(get("/api/v1/accounts/{id}", UUID.randomUUID())
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(BAD_TOKEN)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("TOKEN_EXPIRED"));
    }

    @Test
    @DisplayName("GET /accounts/{id} -> 200 for the owner")
    void getAccount() throws Exception {
        UUID id = UUID.randomUUID();
        when(accountService.getAccount(id)).thenReturn(sampleAccount(id, AccountStatus.ACTIVE));

        mockMvc.perform(get("/api/v1/accounts/{id}", id)
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(CUSTOMER_TOKEN)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.customerId").value("CUST-1001"))
                .andExpect(jsonPath("$.data.status").value("ACTIVE"));
    }

    @Test
    @DisplayName("unknown account -> 404 ACCOUNT_NOT_FOUND")
    void accountNotFound() throws Exception {
        UUID id = UUID.randomUUID();
        when(accountService.getAccount(id)).thenThrow(new AccountNotFoundException(id.toString()));

        mockMvc.perform(get("/api/v1/accounts/{id}", id)
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(CUSTOMER_TOKEN)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("ACCOUNT_NOT_FOUND"));
    }

    @Test
    @DisplayName("malformed id -> 400 BAD_REQUEST")
    void malformedId() throws Exception {
        mockMvc.perform(get("/api/v1/accounts/not-a-uuid")
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(CUSTOMER_TOKEN)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));
    }

    @Test
    @DisplayName("POST /accounts/{id}/freeze as customer -> 403 FORBIDDEN (admin only)")
    void freezeAsCustomerForbidden() throws Exception {
        mockMvc.perform(post("/api/v1/accounts/{id}/freeze", UUID.randomUUID())
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(CUSTOMER_TOKEN)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        verifyNoInteractions(accountService);
    }

    @Test
    @DisplayName("POST /accounts/{id}/freeze as admin with a reason -> 200 FROZEN")
    void freezeAsAdmin() throws Exception {
        UUID id = UUID.randomUUID();
        when(accountService.freezeAccount(id, "Suspicious activity")).thenReturn(sampleAccount(id, AccountStatus.FROZEN));

        mockMvc.perform(post("/api/v1/accounts/{id}/freeze", id)
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(ADMIN_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"Suspicious activity\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("FROZEN"));
    }

    @Test
    @DisplayName("POST /accounts/{id}/close without body -> reason is null")
    void closeWithoutBody() throws Exception {
        UUID id = UUID.randomUUID();
        when(accountService.closeAccount(eq(id), isNull())).thenReturn(sampleAccount(id, AccountStatus.CLOSED));

        mockMvc.perform(post("/api/v1/accounts/{id}/close", id)
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(CUSTOMER_TOKEN)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("CLOSED"));
    }

    @Test
    @DisplayName("GET /accounts -> paged response; page size is capped at 100")
    void listAccountsCapsPageSize() throws Exception {
        UUID id = UUID.randomUUID();
        PagedResponse<AccountSummaryResponse> page = new PagedResponse<>(List.of(new AccountSummaryResponse(id,
                "ACC1234567890", AccountType.SAVINGS, AccountStatus.ACTIVE, "INR", new BigDecimal("10.00"),
                "Rahul Sharma")), 0, 100, 1);
        when(accountService.listAccounts(isNull(), eq(AccountStatus.ACTIVE), any(Pageable.class))).thenReturn(page);

        mockMvc.perform(get("/api/v1/accounts")
                        .param("status", "ACTIVE")
                        .param("size", "500")
                        .header(SecurityConstants.AUTHORIZATION_HEADER, bearer(CUSTOMER_TOKEN)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.content[0].accountNumber").value("ACC1234567890"))
                .andExpect(jsonPath("$.data.totalElements").value(1));

        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(accountService).listAccounts(isNull(), eq(AccountStatus.ACTIVE), pageable.capture());
        assertThat(pageable.getValue().getPageSize()).isEqualTo(100);
        assertThat(pageable.getValue().getPageNumber()).isZero();
    }
}

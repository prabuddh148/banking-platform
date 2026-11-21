package com.banking.account.controller;

import com.banking.account.dto.request.CreateAccountRequest;
import com.banking.account.dto.request.StatusChangeRequest;
import com.banking.account.dto.request.UpdateAccountRequest;
import com.banking.account.dto.response.AccountResponse;
import com.banking.account.dto.response.AccountSummaryResponse;
import com.banking.account.entity.AccountStatus;
import com.banking.account.service.AccountService;
import com.banking.common.dto.ApiResponse;
import com.banking.common.dto.PagedResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * REST endpoints for accounts ({@code /api/v1/accounts}).
 * The controller only translates HTTP <-> service calls; rules and ownership checks live in
 * {@link AccountService}. Admin-only endpoints are guarded with {@code @PreAuthorize}.
 */
@RestController
@RequestMapping("/api/v1/accounts")
@RequiredArgsConstructor
public class AccountController {

    static final int DEFAULT_PAGE_SIZE = 20;
    static final int MAX_PAGE_SIZE = 100;

    private final AccountService accountService;

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<AccountResponse> createAccount(@Valid @RequestBody CreateAccountRequest request) {
        return ApiResponse.success(accountService.createAccount(request));
    }

    @GetMapping
    public ApiResponse<PagedResponse<AccountSummaryResponse>> listAccounts(
            @RequestParam(required = false) String customerId,
            @RequestParam(required = false) AccountStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "" + DEFAULT_PAGE_SIZE) int size) {
        return ApiResponse.success(accountService.listAccounts(customerId, status, pageable(page, size)));
    }

    @GetMapping("/{id}")
    public ApiResponse<AccountResponse> getAccount(@PathVariable UUID id) {
        return ApiResponse.success(accountService.getAccount(id));
    }

    @GetMapping("/number/{accountNumber}")
    public ApiResponse<AccountResponse> getAccountByNumber(@PathVariable String accountNumber) {
        return ApiResponse.success(accountService.getAccountByNumber(accountNumber));
    }

    @PatchMapping("/{id}")
    public ApiResponse<AccountResponse> updateAccount(@PathVariable UUID id,
                                                      @Valid @RequestBody UpdateAccountRequest request) {
        return ApiResponse.success(accountService.updateAccount(id, request));
    }

    @PostMapping("/{id}/freeze")
    @PreAuthorize("hasRole('ADMIN')")
    public ApiResponse<AccountResponse> freezeAccount(@PathVariable UUID id,
                                                      @Valid @RequestBody(required = false) StatusChangeRequest body) {
        return ApiResponse.success(accountService.freezeAccount(id, reason(body)));
    }

    @PostMapping("/{id}/unfreeze")
    @PreAuthorize("hasRole('ADMIN')")
    public ApiResponse<AccountResponse> unfreezeAccount(@PathVariable UUID id,
                                                        @Valid @RequestBody(required = false) StatusChangeRequest body) {
        return ApiResponse.success(accountService.unfreezeAccount(id, reason(body)));
    }

    @PostMapping("/{id}/close")
    public ApiResponse<AccountResponse> closeAccount(@PathVariable UUID id,
                                                     @Valid @RequestBody(required = false) StatusChangeRequest body) {
        return ApiResponse.success(accountService.closeAccount(id, reason(body)));
    }

    private static String reason(StatusChangeRequest body) {
        return body == null ? null : body.getReason();
    }

    /** page is 0-based; size is clamped to 1..100. Newest accounts first. */
    private static Pageable pageable(int page, int size) {
        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        return PageRequest.of(Math.max(page, 0), safeSize, Sort.by(Sort.Direction.DESC, "createdAt"));
    }
}

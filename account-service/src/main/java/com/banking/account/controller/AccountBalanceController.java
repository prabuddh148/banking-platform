package com.banking.account.controller;

import com.banking.account.dto.request.ReserveBalanceRequest;
import com.banking.account.dto.response.AccountBalanceResponse;
import com.banking.account.service.AccountBalanceService;
import com.banking.common.dto.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * Balance endpoints of an account ({@code /api/v1/accounts/{id}/balance}).
 * Reading is for the owner or an admin; reserving/releasing funds is admin-only.
 */
@RestController
@RequestMapping("/api/v1/accounts/{id}/balance")
@RequiredArgsConstructor
public class AccountBalanceController {

    private final AccountBalanceService accountBalanceService;

    @GetMapping
    public ApiResponse<AccountBalanceResponse> getBalance(@PathVariable UUID id) {
        return ApiResponse.success(accountBalanceService.getBalance(id));
    }

    @PostMapping("/reserve")
    @PreAuthorize("hasRole('ADMIN')")
    public ApiResponse<AccountBalanceResponse> reserve(@PathVariable UUID id,
                                                       @Valid @RequestBody ReserveBalanceRequest request) {
        return ApiResponse.success(accountBalanceService.reserve(id, request));
    }

    @PostMapping("/release")
    @PreAuthorize("hasRole('ADMIN')")
    public ApiResponse<AccountBalanceResponse> release(@PathVariable UUID id,
                                                       @Valid @RequestBody ReserveBalanceRequest request) {
        return ApiResponse.success(accountBalanceService.release(id, request));
    }
}

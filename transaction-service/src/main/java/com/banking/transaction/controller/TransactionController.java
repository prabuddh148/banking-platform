package com.banking.transaction.controller;

import com.banking.common.dto.ApiResponse;
import com.banking.common.dto.PagedResponse;
import com.banking.common.security.SecurityConstants;
import com.banking.transaction.dto.request.DepositRequest;
import com.banking.transaction.dto.request.TransferRequest;
import com.banking.transaction.dto.response.TransactionResponse;
import com.banking.transaction.entity.TransactionStatus;
import com.banking.transaction.entity.TransactionType;
import com.banking.transaction.service.TransactionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * REST API for creating and reading transactions.
 * <p>
 * Create endpoints answer <b>202 Accepted</b>: the transaction is saved as PENDING and the saga
 * runs in the background. Poll {@code GET /{id}} or {@code GET /{id}/status} to follow it.
 */
@RestController
@RequestMapping("/api/v1/transactions")
@RequiredArgsConstructor
public class TransactionController {

    private final TransactionService transactionService;

    @PostMapping("/deposit")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ApiResponse<TransactionResponse> deposit(
            @Valid @RequestBody DepositRequest request,
            @RequestHeader(value = SecurityConstants.HEADER_IDEMPOTENCY_KEY, required = false) String idempotencyKey,
            @RequestHeader(value = SecurityConstants.HEADER_CLIENT_COUNTRY, required = false) String clientCountry) {
        return ApiResponse.success(transactionService.deposit(request, idempotencyKey, clientCountry));
    }

    @PostMapping("/withdraw")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ApiResponse<TransactionResponse> withdraw(
            @Valid @RequestBody DepositRequest request,
            @RequestHeader(value = SecurityConstants.HEADER_IDEMPOTENCY_KEY, required = false) String idempotencyKey,
            @RequestHeader(value = SecurityConstants.HEADER_CLIENT_COUNTRY, required = false) String clientCountry) {
        return ApiResponse.success(transactionService.withdraw(request, idempotencyKey, clientCountry));
    }

    @PostMapping("/transfer")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ApiResponse<TransactionResponse> transfer(
            @Valid @RequestBody TransferRequest request,
            @RequestHeader(value = SecurityConstants.HEADER_IDEMPOTENCY_KEY, required = false) String idempotencyKey,
            @RequestHeader(value = SecurityConstants.HEADER_CLIENT_COUNTRY, required = false) String clientCountry) {
        return ApiResponse.success(transactionService.transfer(request, idempotencyKey, clientCountry));
    }

    @GetMapping("/{id}")
    public ApiResponse<TransactionResponse> getTransaction(@PathVariable UUID id) {
        return ApiResponse.success(transactionService.getTransaction(id));
    }

    @GetMapping("/reference/{reference}")
    public ApiResponse<TransactionResponse> getByReference(@PathVariable String reference) {
        return ApiResponse.success(transactionService.getTransactionByReference(reference));
    }

    /** Customers: their own transactions. Admins: all, filterable by account, status and type. */
    @GetMapping
    public ApiResponse<PagedResponse<TransactionResponse>> listTransactions(
            @RequestParam(required = false) String accountId,
            @RequestParam(required = false) TransactionStatus status,
            @RequestParam(required = false) TransactionType type,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.success(transactionService.listTransactions(accountId, status, type, page, size));
    }
}

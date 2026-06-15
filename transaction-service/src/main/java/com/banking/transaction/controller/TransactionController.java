package com.banking.transaction.controller;

import com.banking.common.dto.ApiResponse;
import com.banking.common.dto.PagedResponse;
import com.banking.transaction.dto.request.DepositRequest;
import com.banking.transaction.dto.request.TransferRequest;
import com.banking.transaction.dto.response.TransactionResponse;
import com.banking.transaction.dto.response.TransactionStatusResponse;
import com.banking.transaction.service.TransactionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/transactions")
@Validated
@Slf4j
@RequiredArgsConstructor
public class TransactionController {

    private final TransactionService transactionService;

    @PostMapping("/transfer")
    public ResponseEntity<ApiResponse<TransactionResponse>> initiateTransfer(
            @Valid @RequestBody TransferRequest request) {
        log.info("POST /api/v1/transactions/transfer - initiating transfer");
        TransactionResponse response = transactionService.initiateTransfer(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success(response, "Transfer initiated successfully"));
    }

    @PostMapping("/deposit")
    public ResponseEntity<ApiResponse<TransactionResponse>> initiateDeposit(
            @Valid @RequestBody DepositRequest request) {
        log.info("POST /api/v1/transactions/deposit - initiating deposit");
        TransactionResponse response = transactionService.initiateDeposit(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success(response, "Deposit initiated successfully"));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<TransactionResponse>> getTransaction(
            @PathVariable UUID id) {
        log.info("GET /api/v1/transactions/{}", id);
        TransactionResponse response = transactionService.getTransaction(id);
        return ResponseEntity.ok(ApiResponse.success(response, "Transaction retrieved successfully"));
    }

    @GetMapping("/reference/{referenceNumber}")
    public ResponseEntity<ApiResponse<TransactionResponse>> getTransactionByReference(
            @PathVariable String referenceNumber) {
        log.info("GET /api/v1/transactions/reference/{}", referenceNumber);
        TransactionResponse response = transactionService.getTransactionByReference(referenceNumber);
        return ResponseEntity.ok(ApiResponse.success(response, "Transaction retrieved successfully"));
    }

    @GetMapping("/account/{accountId}")
    public ResponseEntity<ApiResponse<PagedResponse<TransactionResponse>>> getTransactionsByAccount(
            @PathVariable UUID accountId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        log.info("GET /api/v1/transactions/account/{} - page={}, size={}", accountId, page, size);
        PagedResponse<TransactionResponse> response = transactionService.getTransactionsByAccount(accountId, page, size);
        return ResponseEntity.ok(ApiResponse.success(response, "Transactions retrieved successfully"));
    }

    @GetMapping("/{id}/status")
    public ResponseEntity<ApiResponse<TransactionStatusResponse>> getStatus(
            @PathVariable UUID id) {
        log.info("GET /api/v1/transactions/{}/status", id);
        TransactionStatusResponse response = transactionService.getStatus(id);
        return ResponseEntity.ok(ApiResponse.success(response, "Transaction status retrieved successfully"));
    }
}

package com.banking.transaction.controller;

import com.banking.common.dto.ApiResponse;
import com.banking.transaction.dto.response.SagaStateResponse;
import com.banking.transaction.dto.response.TransactionStatusResponse;
import com.banking.transaction.service.TransactionService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * Endpoints for following a transaction's progress: its status history (owner or admin)
 * and the raw saga state (admin only).
 */
@RestController
@RequestMapping("/api/v1/transactions")
@RequiredArgsConstructor
public class TransactionStatusController {

    private final TransactionService transactionService;

    @GetMapping("/{id}/status")
    public ApiResponse<TransactionStatusResponse> getStatus(@PathVariable UUID id) {
        return ApiResponse.success(transactionService.getTransactionStatus(id));
    }

    @GetMapping("/{id}/saga")
    @PreAuthorize("hasRole('ADMIN')")
    public ApiResponse<SagaStateResponse> getSaga(@PathVariable UUID id) {
        return ApiResponse.success(transactionService.getSagaState(id));
    }
}

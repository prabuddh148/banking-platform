package com.banking.fraud.controller;

import com.banking.common.dto.ApiResponse;
import com.banking.common.dto.PagedResponse;
import com.banking.common.security.CurrentUser;
import com.banking.fraud.dto.request.FraudCheckRequest;
import com.banking.fraud.dto.request.ReviewFraudAlertRequest;
import com.banking.fraud.dto.response.FraudAlertResponse;
import com.banking.fraud.dto.response.FraudDecisionResponse;
import com.banking.fraud.dto.response.FraudStatsResponse;
import com.banking.fraud.entity.AlertStatus;
import com.banking.fraud.entity.RiskLevel;
import com.banking.fraud.service.FraudDetectionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * REST API of the fraud-service ({@code /api/v1/fraud}). Everything except reading the decision of
 * one's own transaction is admin-only.
 */
@RestController
@RequestMapping("/api/v1/fraud")
@RequiredArgsConstructor
public class FraudAlertController {

    private static final int MAX_PAGE_SIZE = 100;

    private final FraudDetectionService fraudDetectionService;

    /** Dry run: what would the rules decide for this transaction? Nothing is stored. */
    @PostMapping("/check")
    @PreAuthorize("hasRole('ADMIN')")
    public ApiResponse<FraudDecisionResponse> check(@Valid @RequestBody FraudCheckRequest request) {
        return ApiResponse.success(fraudDetectionService.checkTransaction(request));
    }

    @GetMapping("/alerts")
    @PreAuthorize("hasRole('ADMIN')")
    public ApiResponse<PagedResponse<FraudAlertResponse>> getAlerts(
            @RequestParam(required = false) AlertStatus status,
            @RequestParam(required = false) RiskLevel riskLevel,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        var pageable = PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), MAX_PAGE_SIZE),
                Sort.by(Sort.Direction.DESC, "createdAt"));
        return ApiResponse.success(fraudDetectionService.getAlerts(status, riskLevel, pageable));
    }

    @GetMapping("/alerts/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ApiResponse<FraudAlertResponse> getAlert(@PathVariable UUID id) {
        return ApiResponse.success(fraudDetectionService.getAlert(id));
    }

    /** Admin approves (FRAUD_CLEARED) or rejects (FRAUD_DETECTED with BLOCK) an OPEN alert. */
    @PostMapping("/alerts/{id}/review")
    @PreAuthorize("hasRole('ADMIN')")
    public ApiResponse<FraudAlertResponse> review(@PathVariable UUID id,
                                                  @Valid @RequestBody ReviewFraudAlertRequest request) {
        String reviewerId = CurrentUser.require().userId();
        return ApiResponse.success(fraudDetectionService.reviewAlert(id, request, reviewerId));
    }

    /** Customers may read the decision for their own transactions; admins for any. */
    @GetMapping("/decisions/transaction/{transactionId}")
    public ApiResponse<FraudDecisionResponse> getDecision(@PathVariable String transactionId) {
        return ApiResponse.success(fraudDetectionService.getDecisionByTransactionId(transactionId));
    }

    @GetMapping("/stats")
    @PreAuthorize("hasRole('ADMIN')")
    public ApiResponse<FraudStatsResponse> stats() {
        return ApiResponse.success(fraudDetectionService.getStats());
    }
}

package com.banking.transaction.controller;

import com.banking.common.dto.ApiResponse;
import com.banking.transaction.dto.response.SagaStateResponse;
import com.banking.transaction.entity.SagaState;
import com.banking.transaction.entity.TransactionAudit;
import com.banking.transaction.repository.SagaStateRepository;
import com.banking.transaction.repository.TransactionAuditRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/transactions/{id}")
@Slf4j
@RequiredArgsConstructor
public class TransactionStatusController {

    private final SagaStateRepository sagaStateRepository;
    private final TransactionAuditRepository transactionAuditRepository;

    @GetMapping("/saga")
    public ResponseEntity<ApiResponse<SagaStateResponse>> getSagaState(@PathVariable UUID id) {
        log.info("GET /api/v1/transactions/{}/saga", id);
        SagaState sagaState = sagaStateRepository.findByTransactionId(id)
                .orElseThrow(() -> new com.banking.common.exception.ResourceNotFoundException("SagaState", id.toString()));

        SagaStateResponse response = SagaStateResponse.builder()
                .transactionId(sagaState.getTransactionId())
                .currentStep(sagaState.getCurrentStep())
                .sagaStatus(sagaState.getSagaStatus())
                .createdAt(sagaState.getCreatedAt())
                .updatedAt(sagaState.getUpdatedAt())
                .build();

        return ResponseEntity.ok(ApiResponse.success(response, "Saga state retrieved successfully"));
    }

    @GetMapping("/audit")
    public ResponseEntity<ApiResponse<List<TransactionAudit>>> getAuditTrail(@PathVariable UUID id) {
        log.info("GET /api/v1/transactions/{}/audit", id);
        List<TransactionAudit> auditTrail = transactionAuditRepository.findByTransactionIdOrderByRecordedAtDesc(id);
        return ResponseEntity.ok(ApiResponse.success(auditTrail, "Audit trail retrieved successfully"));
    }
}

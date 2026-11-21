package com.banking.transaction.exception;

import com.banking.common.dto.ApiResponse;
import com.banking.common.exception.ErrorCode;
import com.banking.common.web.BaseGlobalExceptionHandler;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Turns exceptions into {@link ApiResponse} error bodies. Most of the mapping is inherited from
 * {@link BaseGlobalExceptionHandler}; this adds the database cases specific to this service.
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler extends BaseGlobalExceptionHandler {

    /**
     * A unique index fired - in practice two requests with the same Idempotency-Key
     * raced each other. The client can simply retry and will get the existing transaction.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiResponse<Void>> handleDataIntegrity(DataIntegrityViolationException ex) {
        log.warn("Data integrity violation: {}", ex.getMostSpecificCause().getMessage());
        return build(ErrorCode.DUPLICATE_TRANSACTION, ErrorCode.DUPLICATE_TRANSACTION.getMessage(), null);
    }

    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<ApiResponse<Void>> handleOptimisticLock(OptimisticLockingFailureException ex) {
        log.warn("Concurrent update: {}", ex.getMessage());
        return build(ErrorCode.CONFLICT, "The transaction was modified concurrently, please retry", null);
    }
}

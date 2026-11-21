package com.banking.account.exception;

import com.banking.common.dto.ApiResponse;
import com.banking.common.exception.ErrorCode;
import com.banking.common.web.BaseGlobalExceptionHandler;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Turns exceptions into JSON {@link ApiResponse} errors. Most mappings come from
 * {@link BaseGlobalExceptionHandler}; this class adds the database-related ones.
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler extends BaseGlobalExceptionHandler {

    /** Two users edited the same account at the same time; the second one should retry. */
    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    public ResponseEntity<ApiResponse<Void>> handleOptimisticLock(ObjectOptimisticLockingFailureException ex) {
        log.warn("Concurrent modification: {}", ex.getMessage());
        return build(ErrorCode.CONFLICT, "The account was modified concurrently, please retry", null);
    }

    /** A unique constraint was violated (e.g. duplicate reservation for the same transaction). */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiResponse<Void>> handleIntegrity(DataIntegrityViolationException ex) {
        log.warn("Data integrity violation: {}", ex.getMostSpecificCause().getMessage());
        return build(ErrorCode.CONFLICT, "Request conflicts with existing data", null);
    }
}

package com.banking.fraud.exception;

import com.banking.common.dto.ApiResponse;
import com.banking.common.exception.ErrorCode;
import com.banking.common.web.BaseGlobalExceptionHandler;
import org.springframework.http.ResponseEntity;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Turns exceptions into {@code ApiResponse} JSON errors. The common cases live in
 * {@link BaseGlobalExceptionHandler}; here we only add what is specific to fraud-service.
 */
@RestControllerAdvice
public class GlobalExceptionHandler extends BaseGlobalExceptionHandler {

    /** Two admins reviewed the same alert at the same time; the second one loses. */
    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    public ResponseEntity<ApiResponse<Void>> handleOptimisticLock(ObjectOptimisticLockingFailureException ex) {
        return build(ErrorCode.CONFLICT, "The alert was modified by someone else, please reload it", null);
    }
}

package com.banking.audit.exception;

import com.banking.common.web.BaseGlobalExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Converts exceptions thrown by the audit controllers into {@code ApiResponse} error JSON.
 * All mappings (BankingException such as AUDIT_LOG_NOT_FOUND, validation errors, bad parameters,
 * access denied, unexpected errors) are inherited from the shared {@link BaseGlobalExceptionHandler}.
 */
@RestControllerAdvice
public class GlobalExceptionHandler extends BaseGlobalExceptionHandler {
}

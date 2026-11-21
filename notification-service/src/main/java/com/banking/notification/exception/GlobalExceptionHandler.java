package com.banking.notification.exception;

import com.banking.common.web.BaseGlobalExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Turns exceptions thrown by the controllers into {@code ApiResponse} error JSON.
 * All the mapping lives in {@link BaseGlobalExceptionHandler} (shared by every service);
 * our own exceptions extend {@code BankingException}, so they are covered too.
 */
@RestControllerAdvice
public class GlobalExceptionHandler extends BaseGlobalExceptionHandler {
}

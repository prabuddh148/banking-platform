package com.banking.gateway.health;

/**
 * Health of one downstream service.
 *
 * @param service   e.g. "account-service"
 * @param url       the health URL that was called
 * @param status    "UP" or "DOWN"
 * @param latencyMs how long the health call took
 */
public record ServiceHealthResponse(String service, String url, String status, long latencyMs) {
}

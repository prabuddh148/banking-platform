package com.banking.gateway.health;

import reactor.core.publisher.Mono;

import java.util.List;

/** Asks every downstream service for its {@code /actuator/health}. */
public interface SystemHealthService {

    /** One entry per configured service, in configuration order. Never fails: unreachable = DOWN. */
    Mono<List<ServiceHealthResponse>> checkAll();
}

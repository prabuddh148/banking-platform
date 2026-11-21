package com.banking.gateway.util;

import org.junit.jupiter.api.Test;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;

import static org.assertj.core.api.Assertions.assertThat;

/** Plain unit test (no Spring context) for the open/secured endpoint rules. */
class RouteValidatorTest {

    private final RouteValidator routeValidator = new RouteValidator();

    @Test
    void loginAndActuatorAreOpen() {
        assertThat(routeValidator.isOpen("/api/v1/auth/login")).isTrue();
        assertThat(routeValidator.isOpen("/actuator")).isTrue();
        assertThat(routeValidator.isOpen("/actuator/health")).isTrue();
        assertThat(routeValidator.isOpen("/actuator/health/liveness")).isTrue();
        assertThat(routeValidator.isOpen("/actuator/prometheus")).isTrue();
    }

    @Test
    void everythingElseIsSecured() {
        assertThat(routeValidator.isSecured(MockServerHttpRequest.get("/api/v1/accounts").build())).isTrue();
        assertThat(routeValidator.isSecured(MockServerHttpRequest.get("/api/v1/accounts/123").build())).isTrue();
        assertThat(routeValidator.isSecured(MockServerHttpRequest.get("/api/v1/auth/me").build())).isTrue();
        assertThat(routeValidator.isSecured(MockServerHttpRequest.get("/api/v1/system/health").build())).isTrue();
        assertThat(routeValidator.isSecured(MockServerHttpRequest.post("/api/v1/auth/login").build())).isFalse();
    }

    @Test
    void lookalikePathsAreNotOpen() {
        assertThat(routeValidator.isOpen("/api/v1/auth/login/extra")).isFalse();
        assertThat(routeValidator.isOpen("/api/v1/actuator/health")).isFalse();
        assertThat(routeValidator.isOpen("/actuatorx")).isFalse();
    }
}

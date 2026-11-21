package com.banking.gateway;

import com.banking.common.security.SecurityConstants;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.WebTestClient;

import java.time.Duration;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Starts the whole gateway on a random port. No downstream service is running: the service URLs
 * point at closed local ports, so proxied calls end in the circuit-breaker fallback and every
 * health check reports DOWN.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "ACCOUNT_SERVICE_URL=http://127.0.0.1:59081",
                "TRANSACTION_SERVICE_URL=http://127.0.0.1:59082",
                "FRAUD_SERVICE_URL=http://127.0.0.1:59083",
                "NOTIFICATION_SERVICE_URL=http://127.0.0.1:59084",
                "AUDIT_SERVICE_URL=http://127.0.0.1:59085",
                "gateway.circuit-breaker.timeout=5s"
        })
class ApiGatewayApplicationTests {

    @Autowired
    private WebTestClient webTestClient;

    private WebTestClient client() {
        return webTestClient.mutate().responseTimeout(Duration.ofSeconds(20)).build();
    }

    private String login(String username, String password) {
        JsonNode body = client().post().uri("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("username", username, "password", password))
                .exchange()
                .expectStatus().isOk()
                .expectBody(JsonNode.class)
                .returnResult().getResponseBody();
        assertThat(body).isNotNull();
        return body.path("data").path("accessToken").asText();
    }

    @Test
    void contextLoads() {
        // the context starting is the test
    }

    @Test
    void loginWithDemoUserReturnsToken() {
        client().post().uri("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("username", "rahul", "password", "password"))
                .exchange()
                .expectStatus().isOk()
                .expectHeader().exists(SecurityConstants.HEADER_TRACE_ID)
                .expectBody()
                .jsonPath("$.data.accessToken").isNotEmpty()
                .jsonPath("$.data.tokenType").isEqualTo("Bearer")
                .jsonPath("$.data.expiresIn").isEqualTo(3600)
                .jsonPath("$.data.user.userId").isEqualTo("CUST-1001")
                .jsonPath("$.data.user.roles[0]").isEqualTo(SecurityConstants.ROLE_CUSTOMER);
    }

    @Test
    void loginWithWrongPasswordReturns401() {
        client().post().uri("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("username", "rahul", "password", "wrong"))
                .exchange()
                .expectStatus().isUnauthorized()
                .expectBody()
                .jsonPath("$.data").doesNotExist()
                .jsonPath("$.error.code").isEqualTo("INVALID_CREDENTIALS")
                .jsonPath("$.error.status").isEqualTo(401);
    }

    @Test
    void loginWithBlankFieldsReturnsValidationError() {
        client().post().uri("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("username", "", "password", ""))
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error.code").isEqualTo("VALIDATION_ERROR")
                .jsonPath("$.error.details.username").exists();
    }

    @Test
    void protectedRouteWithoutTokenReturns401() {
        client().get().uri("/api/v1/accounts")
                .exchange()
                .expectStatus().isUnauthorized()
                .expectBody()
                .jsonPath("$.error.code").isEqualTo("UNAUTHORIZED");
    }

    @Test
    void protectedRouteWithInvalidTokenReturns401() {
        client().get().uri("/api/v1/transactions")
                .header(HttpHeaders.AUTHORIZATION, "Bearer not-a-real-token")
                .exchange()
                .expectStatus().isUnauthorized()
                .expectBody()
                .jsonPath("$.error.code").isEqualTo("INVALID_TOKEN");
    }

    @Test
    void meReturnsTheLoggedInUser() {
        String token = login("admin", "admin123");
        client().get().uri("/api/v1/auth/me")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.data.userId").isEqualTo("ADMIN-1")
                .jsonPath("$.data.name").isEqualTo("Devon Ellis");
    }

    @Test
    void meWithoutTokenReturns401() {
        client().get().uri("/api/v1/auth/me")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    void downstreamUnavailableReturnsFallback503() {
        String token = login("priya", "password");
        client().get().uri("/api/v1/accounts")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .exchange()
                .expectStatus().isEqualTo(HttpStatus.SERVICE_UNAVAILABLE)
                .expectBody()
                .jsonPath("$.error.code").isEqualTo("SERVICE_UNAVAILABLE");
    }

    @Test
    void systemHealthIsAdminOnly() {
        String token = login("rahul", "password");
        client().get().uri("/api/v1/system/health")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .exchange()
                .expectStatus().isForbidden()
                .expectBody()
                .jsonPath("$.error.code").isEqualTo("FORBIDDEN");
    }

    @Test
    void systemHealthReportsEveryServiceDown() {
        String token = login("admin", "admin123");
        client().get().uri("/api/v1/system/health")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.data.length()").isEqualTo(5)
                .jsonPath("$.data[0].service").isEqualTo("account-service")
                .jsonPath("$.data[0].url").isEqualTo("http://127.0.0.1:59081/actuator/health")
                .jsonPath("$.data[*].status").value(statuses ->
                        assertThat(statuses.toString()).doesNotContain("UP"));
    }

    @Test
    void actuatorHealthIsOpen() {
        client().get().uri("/actuator/health")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.status").isEqualTo("UP");
    }

    @Test
    void corsPreflightFromFrontendIsAllowed() {
        client().options().uri("/api/v1/accounts")
                .header(HttpHeaders.ORIGIN, "http://localhost:5173")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET")
                .exchange()
                .expectStatus().isOk()
                .expectHeader().valueEquals(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:5173");
    }

    @Test
    void clientTraceIdIsEchoedBack() {
        client().get().uri("/actuator/health")
                .header(SecurityConstants.HEADER_TRACE_ID, "trace-123")
                .exchange()
                .expectHeader().valueEquals(SecurityConstants.HEADER_TRACE_ID, "trace-123");
    }
}

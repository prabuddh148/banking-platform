package com.banking.notification;

import com.banking.common.dto.PagedResponse;
import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.JwtUtil;
import com.banking.common.security.SecurityConstants;
import com.banking.notification.config.SecurityConfig;
import com.banking.notification.controller.NotificationController;
import com.banking.notification.dto.response.NotificationResponse;
import com.banking.notification.entity.NotificationChannel;
import com.banking.notification.entity.NotificationStatus;
import com.banking.notification.entity.NotificationType;
import com.banking.notification.security.JwtTokenValidator;
import com.banking.notification.service.NotificationService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Web-layer test: controller + real security config (JWT filter, 401/403 JSON), service mocked.
 * Tokens are created with the same JwtUtil and secret the service uses.
 */
@WebMvcTest(NotificationController.class)
@Import({SecurityConfig.class, JwtTokenValidator.class})
class NotificationControllerTest {

    private static final String SECRET = "change-me-dev-secret-key-at-least-32-bytes-long";

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private NotificationService notificationService;

    private final JwtUtil jwtUtil = new JwtUtil(SECRET, Duration.ofHours(1));

    @Test
    void noToken_returns401Json() throws Exception {
        mockMvc.perform(get("/api/v1/notifications"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
    }

    @Test
    void invalidToken_returns401Json() throws Exception {
        mockMvc.perform(get("/api/v1/notifications").header("Authorization", "Bearer not-a-jwt"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("INVALID_TOKEN"));
    }

    @Test
    void customer_canListNotifications() throws Exception {
        NotificationResponse item = NotificationResponse.builder()
                .id(UUID.randomUUID()).recipientId("CUST-1001").channel(NotificationChannel.EMAIL)
                .type(NotificationType.WELCOME).status(NotificationStatus.SENT).subject("Welcome")
                .recipient("r***********@example.com").attempts(1).createdAt(Instant.now()).build();
        when(notificationService.getNotifications(any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(new PagedResponse<>(List.of(item), 0, 20, 1));

        mockMvc.perform(get("/api/v1/notifications").header("Authorization", bearer(customer())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.content[0].recipientId").value("CUST-1001"))
                .andExpect(jsonPath("$.data.totalElements").value(1));
    }

    @Test
    void customer_cannotRetry() throws Exception {
        mockMvc.perform(post("/api/v1/notifications/{id}/retry", UUID.randomUUID())
                        .header("Authorization", bearer(customer())))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        verify(notificationService, never()).retry(any());
    }

    @Test
    void admin_canRetry() throws Exception {
        UUID id = UUID.randomUUID();
        when(notificationService.retry(id)).thenReturn(NotificationResponse.builder()
                .id(id).status(NotificationStatus.SENT).attempts(2).build());

        mockMvc.perform(post("/api/v1/notifications/{id}/retry", id).header("Authorization", bearer(admin())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("SENT"));
    }

    private String bearer(AuthenticatedUser user) {
        return SecurityConstants.BEARER_PREFIX + jwtUtil.generateToken(user);
    }

    private static AuthenticatedUser customer() {
        return new AuthenticatedUser("CUST-1001", "rahul", "rahul.sharma@example.com", "Rahul Sharma",
                List.of(SecurityConstants.ROLE_CUSTOMER));
    }

    private static AuthenticatedUser admin() {
        return new AuthenticatedUser("ADMIN-1", "admin", "admin@meridian.bank", "Devon Ellis",
                List.of(SecurityConstants.ROLE_ADMIN, SecurityConstants.ROLE_CUSTOMER));
    }
}

package com.banking.notification.controller;

import com.banking.common.dto.ApiResponse;
import com.banking.common.dto.PagedResponse;
import com.banking.notification.dto.response.NotificationResponse;
import com.banking.notification.entity.NotificationChannel;
import com.banking.notification.entity.NotificationStatus;
import com.banking.notification.service.NotificationService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * REST API for notifications ({@code /api/v1/notifications}).
 * <ul>
 *     <li>{@code GET /} - customers get their own, admins get all (filters recipientId, status, channel)</li>
 *     <li>{@code GET /{id}} - owner or admin</li>
 *     <li>{@code POST /{id}/retry} - admin re-sends a FAILED notification</li>
 *     <li>{@code PATCH /{id}/read} - owner marks it as read</li>
 * </ul>
 * Ownership checks live in the service; this class only maps HTTP to service calls.
 */
@RestController
@RequestMapping("/api/v1/notifications")
@RequiredArgsConstructor
public class NotificationController {

    private final NotificationService notificationService;

    @GetMapping
    public ApiResponse<PagedResponse<NotificationResponse>> list(
            @RequestParam(required = false) String recipientId,
            @RequestParam(required = false) NotificationStatus status,
            @RequestParam(required = false) NotificationChannel channel,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.success(notificationService.getNotifications(recipientId, status, channel, page, size));
    }

    @GetMapping("/{id}")
    public ApiResponse<NotificationResponse> get(@PathVariable UUID id) {
        return ApiResponse.success(notificationService.getNotification(id));
    }

    @PostMapping("/{id}/retry")
    @PreAuthorize("hasRole('ADMIN')")
    public ApiResponse<NotificationResponse> retry(@PathVariable UUID id) {
        return ApiResponse.success(notificationService.retry(id));
    }

    @PatchMapping("/{id}/read")
    public ApiResponse<NotificationResponse> markAsRead(@PathVariable UUID id) {
        return ApiResponse.success(notificationService.markAsRead(id));
    }
}

package com.banking.account.dto.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Body of PATCH /api/v1/accounts/{id}. Only fields that are sent (non-null) are changed.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UpdateAccountRequest {

    @Size(min = 1, max = 150)
    private String customerName;

    @Email(message = "customerEmail must be a valid email")
    private String customerEmail;

    @Pattern(regexp = "^[+]?[0-9]{7,15}$", message = "customerPhone must be 7-15 digits, optionally starting with +")
    private String customerPhone;
}

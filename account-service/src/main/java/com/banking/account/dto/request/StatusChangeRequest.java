package com.banking.account.dto.request;

import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Optional body of the freeze / unfreeze / close endpoints: {"reason": "..."}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class StatusChangeRequest {

    @Size(max = 255)
    private String reason;
}

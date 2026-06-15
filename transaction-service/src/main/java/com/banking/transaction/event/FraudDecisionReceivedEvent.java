package com.banking.transaction.event;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.UUID;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class FraudDecisionReceivedEvent {

    private UUID transactionId;
    private String decision;
    private BigDecimal riskScore;
    private String reason;
}

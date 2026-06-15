package com.banking.transaction.consumer;

import com.banking.transaction.event.FraudDecisionReceivedEvent;
import com.banking.transaction.saga.TransactionSagaOrchestrator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
@Slf4j
@RequiredArgsConstructor
public class FraudDecisionConsumer {

    private final TransactionSagaOrchestrator transactionSagaOrchestrator;

    @KafkaListener(topics = "fraud.decision", groupId = "${spring.kafka.consumer.group-id}")
    public void handleFraudDecision(FraudDecisionReceivedEvent event) {
        log.info("Received fraud decision for transactionId={}, decision={}, riskScore={}",
                event.getTransactionId(), event.getDecision(), event.getRiskScore());
        try {
            transactionSagaOrchestrator.processFraudDecision(event);
        } catch (Exception ex) {
            log.error("Error processing fraud decision for transactionId={}: {}",
                    event.getTransactionId(), ex.getMessage(), ex);
            throw ex;
        }
    }
}

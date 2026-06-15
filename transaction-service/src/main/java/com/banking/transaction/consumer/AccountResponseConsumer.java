package com.banking.transaction.consumer;

import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
@Slf4j
public class AccountResponseConsumer {

    @KafkaListener(topics = "account.status.changed", groupId = "${spring.kafka.consumer.group-id}")
    public void handleAccountStatusChange(Map<String, Object> payload) {
        log.info("Received account status change event: {}", payload);
    }
}

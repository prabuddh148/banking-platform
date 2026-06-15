package com.banking.audit.util;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
@Slf4j
@RequiredArgsConstructor
public class AuditLogFormatter {

    private final ObjectMapper objectMapper;

    /**
     * Converts old and new values to a pair of JSON strings.
     * Returns a String[] where [0] = oldJson, [1] = newJson.
     */
    public String[] formatOldNew(Object oldVal, Object newVal) {
        String oldJson = toJson(oldVal);
        String newJson = toJson(newVal);
        return new String[]{oldJson, newJson};
    }

    /**
     * Builds a human-readable description for an audit event.
     */
    public String buildDescription(String action, String resourceType, UUID resourceId) {
        return String.format("%s performed on %s with id %s", action, resourceType, resourceId);
    }

    private String toJson(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof String str) {
            return str;
        }
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            log.warn("Failed to serialize value to JSON: {}", e.getMessage());
            return value.toString();
        }
    }
}

package com.banking.audit.mapper;

import com.banking.audit.dto.response.AuditLogResponse;
import com.banking.audit.entity.AuditLog;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.TextNode;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.Named;

/**
 * MapStruct mapper: entity -> REST DTO. MapStruct generates {@code AuditLogMapperImpl} at compile time
 * (a Spring bean thanks to {@code componentModel = "spring"}).
 * The only custom step is turning the stored {@code details} JSON text back into a JSON object.
 */
@Mapper(componentModel = "spring")
public interface AuditLogMapper {

    /** A plain ObjectMapper is enough to parse a JSON string into a tree. */
    ObjectMapper JSON = new ObjectMapper();

    @Mapping(target = "details", source = "details", qualifiedByName = "jsonTextToNode")
    AuditLogResponse toResponse(AuditLog auditLog);

    @Named("jsonTextToNode")
    default JsonNode jsonTextToNode(String details) {
        if (details == null || details.isBlank()) {
            return null;
        }
        try {
            return JSON.readTree(details);
        } catch (JsonProcessingException e) {
            // Should not happen (we wrote the JSON ourselves) - fall back to returning the raw text.
            return TextNode.valueOf(details);
        }
    }
}

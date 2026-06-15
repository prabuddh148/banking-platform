package com.banking.audit.mapper;

import com.banking.audit.dto.response.AuditLogResponse;
import com.banking.audit.entity.AuditLog;
import org.mapstruct.Mapper;
import org.mapstruct.ReportingPolicy;

@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.IGNORE)
public interface AuditLogMapper {

    AuditLogResponse toResponse(AuditLog auditLog);
}

package com.banking.transaction.mapper;

import com.banking.transaction.dto.request.TransferRequest;
import com.banking.transaction.dto.response.TransactionResponse;
import com.banking.transaction.entity.Transaction;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.ReportingPolicy;

@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.IGNORE)
public interface TransactionMapper {

    TransactionResponse toResponse(Transaction transaction);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "referenceNumber", ignore = true)
    @Mapping(target = "status", ignore = true)
    @Mapping(target = "initiatedAt", ignore = true)
    @Mapping(target = "completedAt", ignore = true)
    @Mapping(target = "version", ignore = true)
    @Mapping(target = "transactionType", ignore = true)
    @Mapping(target = "metadata", ignore = true)
    Transaction toEntity(TransferRequest request);
}

package com.banking.transaction.mapper;

import com.banking.transaction.dto.response.SagaStateResponse;
import com.banking.transaction.dto.response.TransactionResponse;
import com.banking.transaction.dto.response.TransactionStatusResponse;
import com.banking.transaction.entity.SagaState;
import com.banking.transaction.entity.Transaction;
import com.banking.transaction.entity.TransactionStatusHistory;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

import java.util.List;

/**
 * Entity -> DTO conversion. MapStruct generates the implementation ({@code TransactionMapperImpl})
 * at compile time; fields with the same name are copied automatically.
 */
@Mapper(componentModel = "spring")
public interface TransactionMapper {

    TransactionResponse toResponse(Transaction transaction);

    @Mapping(target = "sagaId", source = "id")
    SagaStateResponse toSagaResponse(SagaState sagaState);

    TransactionStatusResponse.StatusChange toStatusChange(TransactionStatusHistory history);

    List<TransactionStatusResponse.StatusChange> toStatusChanges(List<TransactionStatusHistory> history);

    /** Combines the transaction with its history rows (written by hand because there are two sources). */
    default TransactionStatusResponse toStatusResponse(Transaction transaction, List<TransactionStatusHistory> history) {
        return TransactionStatusResponse.builder()
                .transactionId(transaction.getId())
                .reference(transaction.getReference())
                .status(transaction.getStatus())
                .failureReason(transaction.getFailureReason())
                .history(toStatusChanges(history))
                .build();
    }
}

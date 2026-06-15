package com.banking.transaction.service;

import com.banking.common.dto.PagedResponse;
import com.banking.transaction.dto.request.DepositRequest;
import com.banking.transaction.dto.request.TransferRequest;
import com.banking.transaction.dto.response.TransactionResponse;
import com.banking.transaction.dto.response.TransactionStatusResponse;

import java.util.UUID;

public interface TransactionService {

    TransactionResponse initiateTransfer(TransferRequest request);

    TransactionResponse initiateDeposit(DepositRequest request);

    TransactionResponse getTransaction(UUID id);

    TransactionResponse getTransactionByReference(String referenceNumber);

    PagedResponse<TransactionResponse> getTransactionsByAccount(UUID accountId, int page, int size);

    TransactionStatusResponse getStatus(UUID id);
}

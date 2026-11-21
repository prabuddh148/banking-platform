package com.banking.transaction.service;

import com.banking.common.dto.PagedResponse;
import com.banking.transaction.dto.request.DepositRequest;
import com.banking.transaction.dto.request.TransferRequest;
import com.banking.transaction.dto.response.SagaStateResponse;
import com.banking.transaction.dto.response.TransactionResponse;
import com.banking.transaction.dto.response.TransactionStatusResponse;
import com.banking.transaction.entity.TransactionStatus;
import com.banking.transaction.entity.TransactionType;

import java.util.UUID;

/**
 * Use cases of transaction-service as called by the REST controllers.
 * Creating a transaction only STARTS it (status PENDING); the saga finishes it asynchronously.
 */
public interface TransactionService {

    /**
     * @param idempotencyKey optional; the same key from the same user returns the existing transaction
     * @param clientCountry  optional value of the X-Client-Country header (passed to fraud checks)
     */
    TransactionResponse deposit(DepositRequest request, String idempotencyKey, String clientCountry);

    TransactionResponse withdraw(DepositRequest request, String idempotencyKey, String clientCountry);

    TransactionResponse transfer(TransferRequest request, String idempotencyKey, String clientCountry);

    TransactionResponse getTransaction(UUID id);

    TransactionResponse getTransactionByReference(String reference);

    /**
     * Customers see only transactions they initiated (optionally narrowed to one account);
     * admins see everything and can filter freely. Null filters are ignored.
     */
    PagedResponse<TransactionResponse> listTransactions(String accountId, TransactionStatus status,
                                                        TransactionType type, int page, int size);

    TransactionStatusResponse getTransactionStatus(UUID id);

    SagaStateResponse getSagaState(UUID transactionId);
}

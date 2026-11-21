package com.banking.account.service;

import com.banking.account.dto.request.CreateAccountRequest;
import com.banking.account.dto.request.UpdateAccountRequest;
import com.banking.account.dto.response.AccountResponse;
import com.banking.account.dto.response.AccountSummaryResponse;
import com.banking.account.entity.AccountStatus;
import com.banking.common.dto.PagedResponse;
import org.springframework.data.domain.Pageable;

import java.util.UUID;

/**
 * Account lifecycle: open, read, edit, freeze, unfreeze, close.
 * All methods check that the logged-in user owns the account (or is an admin).
 */
public interface AccountService {

    AccountResponse createAccount(CreateAccountRequest request);

    AccountResponse getAccount(UUID accountId);

    AccountResponse getAccountByNumber(String accountNumber);

    /**
     * Customers always get only their own accounts (customerId filter ignored);
     * admins see all accounts, optionally filtered by customerId and/or status.
     */
    PagedResponse<AccountSummaryResponse> listAccounts(String customerId, AccountStatus status, Pageable pageable);

    AccountResponse updateAccount(UUID accountId, UpdateAccountRequest request);

    AccountResponse freezeAccount(UUID accountId, String reason);

    AccountResponse unfreezeAccount(UUID accountId, String reason);

    AccountResponse closeAccount(UUID accountId, String reason);
}

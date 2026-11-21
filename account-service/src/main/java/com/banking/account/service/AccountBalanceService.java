package com.banking.account.service;

import com.banking.account.dto.request.ReserveBalanceRequest;
import com.banking.account.dto.response.AccountBalanceResponse;
import com.banking.account.entity.BalanceUpdateOutcome;
import com.banking.account.event.BalanceUpdateRequestedEvent;

import java.util.UUID;

/**
 * Everything that touches the money in an account: reading the balance, putting funds on
 * hold, and applying the debit/credit requested by the transaction saga.
 */
public interface AccountBalanceService {

    AccountBalanceResponse getBalance(UUID accountId);

    /** Puts {@code amount} on hold for a transaction (available balance goes down). */
    AccountBalanceResponse reserve(UUID accountId, ReserveBalanceRequest request);

    /** Removes the hold placed for the same transaction. */
    AccountBalanceResponse release(UUID accountId, ReserveBalanceRequest request);

    /**
     * Handles BALANCE_UPDATE_REQUESTED atomically and idempotently: either all balances change
     * and BALANCE_UPDATED is queued, or nothing changes and BALANCE_UPDATE_FAILED is queued.
     *
     * @return the outcome, or {@code null} when the transaction was already processed (duplicate delivery)
     */
    BalanceUpdateOutcome applyBalanceUpdate(BalanceUpdateRequestedEvent event);
}

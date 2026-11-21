package com.banking.account.validation;

import com.banking.account.entity.Account;
import com.banking.account.entity.AccountBalance;
import com.banking.account.entity.AccountStatus;
import com.banking.account.exception.InsufficientFundsException;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.banking.common.util.MoneyUtil;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;

/**
 * Business rules about accounts, in one place so the REST flows and the Kafka balance-update
 * flow apply exactly the same checks. Every method throws a {@link BankingException} with the
 * matching {@link ErrorCode} when the rule is broken.
 */
@Component
public class AccountValidator {

    /** Money can only move in/out of ACTIVE accounts. */
    public void requireActive(Account account) {
        if (account.getStatus() == AccountStatus.FROZEN) {
            throw new BankingException(ErrorCode.ACCOUNT_FROZEN, "Account " + account.getAccountNumber() + " is frozen");
        }
        if (account.getStatus() == AccountStatus.CLOSED) {
            throw new BankingException(ErrorCode.ACCOUNT_CLOSED, "Account " + account.getAccountNumber() + " is closed");
        }
    }

    /** Closed accounts can't be edited or have their status changed any more. */
    public void requireNotClosed(Account account) {
        if (account.getStatus() == AccountStatus.CLOSED) {
            throw new BankingException(ErrorCode.ACCOUNT_CLOSED, "Account " + account.getAccountNumber() + " is closed");
        }
    }

    public void requireCurrency(Account account, String currency) {
        if (currency == null || !account.getCurrency().equalsIgnoreCase(currency)) {
            throw new BankingException(ErrorCode.CURRENCY_MISMATCH,
                    "Currency " + currency + " does not match account currency " + account.getCurrency());
        }
    }

    /** The given user must own the account (used for debits requested via Kafka). */
    public void requireOwner(Account account, String userId) {
        if (userId == null || !userId.equals(account.getCustomerId())) {
            throw new BankingException(ErrorCode.FORBIDDEN,
                    "User " + userId + " does not own account " + account.getAccountNumber());
        }
    }

    public void requirePositiveAmount(BigDecimal amount) {
        if (!MoneyUtil.isPositive(amount)) {
            throw new BankingException(ErrorCode.INVALID_TRANSACTION, "Amount must be greater than zero");
        }
    }

    /**
     * Checks available funds (ledger - reserved) plus any extra amount that is already held for
     * this very operation (e.g. a reservation that is about to be consumed).
     */
    public void requireSufficientFunds(AccountBalance balance, BigDecimal amount, BigDecimal alreadyHeldForThis) {
        BigDecimal spendable = MoneyUtil.add(balance.getAvailableBalance(), alreadyHeldForThis);
        if (!MoneyUtil.hasSufficientFunds(spendable, amount)) {
            throw new InsufficientFundsException(balance.getAccount().getAccountNumber(), spendable,
                    MoneyUtil.normalize(amount));
        }
    }

    /** An account can only be closed when it holds no money and nothing is reserved. */
    public void requireZeroBalance(AccountBalance balance) {
        if (MoneyUtil.normalize(balance.getLedgerBalance()).signum() != 0
                || MoneyUtil.normalize(balance.getReservedAmount()).signum() != 0) {
            throw new BankingException(ErrorCode.CONFLICT,
                    "Account balance must be zero before closing (current balance "
                            + MoneyUtil.normalize(balance.getLedgerBalance()) + ")");
        }
    }

    /** Allowed transitions: ACTIVE->FROZEN, FROZEN->ACTIVE, ACTIVE/FROZEN->CLOSED. */
    public void requireTransition(Account account, AccountStatus target) {
        requireNotClosed(account);
        AccountStatus current = account.getStatus();
        boolean allowed = switch (target) {
            case FROZEN -> current == AccountStatus.ACTIVE;
            case ACTIVE -> current == AccountStatus.FROZEN;
            case CLOSED -> true;
        };
        if (!allowed) {
            throw new BankingException(ErrorCode.CONFLICT,
                    "Cannot change account " + account.getAccountNumber() + " from " + current + " to " + target);
        }
    }
}

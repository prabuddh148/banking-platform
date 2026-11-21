package com.banking.account.service;

import com.banking.account.dto.request.CreateAccountRequest;
import com.banking.account.dto.request.UpdateAccountRequest;
import com.banking.account.dto.response.AccountResponse;
import com.banking.account.dto.response.AccountSummaryResponse;
import com.banking.account.entity.Account;
import com.banking.account.entity.AccountBalance;
import com.banking.account.entity.AccountStatus;
import com.banking.account.entity.AccountStatusHistory;
import com.banking.account.event.AccountCreatedEvent;
import com.banking.account.event.AccountStatusChangedEvent;
import com.banking.account.exception.AccountNotFoundException;
import com.banking.account.mapper.AccountMapper;
import com.banking.account.producer.AccountEventProducer;
import com.banking.account.repository.AccountBalanceRepository;
import com.banking.account.repository.AccountRepository;
import com.banking.account.repository.AccountStatusHistoryRepository;
import com.banking.account.util.AccountNumberGenerator;
import com.banking.account.validation.AccountValidator;
import com.banking.common.dto.PagedResponse;
import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.CurrentUser;
import com.banking.common.util.MaskingUtil;
import com.banking.common.util.MoneyUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Default {@link AccountService}. Every write method runs in one DB transaction that saves the
 * account change, a status-history row (for status changes) and the outbox event together.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AccountServiceImpl implements AccountService {

    private final AccountRepository accountRepository;
    private final AccountBalanceRepository accountBalanceRepository;
    private final AccountStatusHistoryRepository statusHistoryRepository;
    private final AccountNumberGenerator accountNumberGenerator;
    private final AccountValidator accountValidator;
    private final AccountEventProducer eventProducer;
    private final AccountMapper accountMapper;

    @Override
    @Transactional
    public AccountResponse createAccount(CreateAccountRequest request) {
        AuthenticatedUser user = CurrentUser.require();
        // Customers always open accounts for themselves; only admins may pick another customerId.
        String customerId = user.isAdmin() && StringUtils.hasText(request.getCustomerId())
                ? request.getCustomerId().trim()
                : user.userId();
        String currency = StringUtils.hasText(request.getCurrency())
                ? request.getCurrency().trim().toUpperCase()
                : MoneyUtil.DEFAULT_CURRENCY;
        BigDecimal openingBalance = MoneyUtil.normalize(request.getInitialDeposit());

        Account account = Account.builder()
                .accountNumber(accountNumberGenerator.generate())
                .customerId(customerId)
                .customerName(request.getCustomerName().trim())
                .customerEmail(request.getCustomerEmail().trim())
                .customerPhone(request.getCustomerPhone())
                .accountType(request.getAccountType())
                .status(AccountStatus.ACTIVE)
                .currency(currency)
                .build();
        // The initial deposit becomes the opening balance directly (no saga needed).
        account.attachBalance(AccountBalance.builder()
                .ledgerBalance(openingBalance)
                .reservedAmount(MoneyUtil.ZERO)
                .currency(currency)
                .build());

        Account saved = accountRepository.save(account);
        recordHistory(saved, null, AccountStatus.ACTIVE, "Account opened", user.userId());

        eventProducer.publish(AccountCreatedEvent.builder()
                .accountId(saved.getId().toString())
                .accountNumber(saved.getAccountNumber())
                .customerId(saved.getCustomerId())
                .customerName(saved.getCustomerName())
                .customerEmail(saved.getCustomerEmail())
                .customerPhone(saved.getCustomerPhone())
                .accountType(saved.getAccountType().name())
                .currency(saved.getCurrency())
                .initialBalance(openingBalance)
                .build(), AccountEventProducer.AGGREGATE_ACCOUNT);

        log.info("Opened {} account {} for customer {} (opening balance {} {})", saved.getAccountType(),
                MaskingUtil.maskAccountNumber(saved.getAccountNumber()), customerId, openingBalance, currency);
        return accountMapper.toResponse(saved);
    }

    @Override
    @Transactional(readOnly = true)
    public AccountResponse getAccount(UUID accountId) {
        Account account = findAccount(accountId);
        CurrentUser.requireOwnerOrAdmin(account.getCustomerId());
        return accountMapper.toResponse(account);
    }

    @Override
    @Transactional(readOnly = true)
    public AccountResponse getAccountByNumber(String accountNumber) {
        Account account = accountRepository.findByAccountNumber(accountNumber)
                .orElseThrow(() -> new AccountNotFoundException(accountNumber));
        CurrentUser.requireOwnerOrAdmin(account.getCustomerId());
        return accountMapper.toResponse(account);
    }

    @Override
    @Transactional(readOnly = true)
    public PagedResponse<AccountSummaryResponse> listAccounts(String customerId, AccountStatus status,
                                                              Pageable pageable) {
        AuthenticatedUser user = CurrentUser.require();
        String effectiveCustomerId = user.isAdmin() ? customerId : user.userId();

        Specification<Account> spec = Specification.where(null);
        if (StringUtils.hasText(effectiveCustomerId)) {
            spec = spec.and((root, query, cb) -> cb.equal(root.get("customerId"), effectiveCustomerId));
        }
        if (status != null) {
            spec = spec.and((root, query, cb) -> cb.equal(root.get("status"), status));
        }
        Page<Account> page = accountRepository.findAll(spec, pageable);
        return PagedResponse.from(page, accountMapper::toSummary);
    }

    @Override
    @Transactional
    public AccountResponse updateAccount(UUID accountId, UpdateAccountRequest request) {
        Account account = findAccount(accountId);
        CurrentUser.requireOwnerOrAdmin(account.getCustomerId());
        accountValidator.requireNotClosed(account);

        if (StringUtils.hasText(request.getCustomerName())) {
            account.setCustomerName(request.getCustomerName().trim());
        }
        if (StringUtils.hasText(request.getCustomerEmail())) {
            account.setCustomerEmail(request.getCustomerEmail().trim());
        }
        if (request.getCustomerPhone() != null) {
            account.setCustomerPhone(request.getCustomerPhone().isBlank() ? null : request.getCustomerPhone().trim());
        }
        Account saved = accountRepository.save(account);
        log.info("Updated contact details of account {}", MaskingUtil.maskAccountNumber(saved.getAccountNumber()));
        return accountMapper.toResponse(saved);
    }

    @Override
    @Transactional
    public AccountResponse freezeAccount(UUID accountId, String reason) {
        return changeStatus(accountId, AccountStatus.FROZEN, reason, "Frozen by administrator");
    }

    @Override
    @Transactional
    public AccountResponse unfreezeAccount(UUID accountId, String reason) {
        return changeStatus(accountId, AccountStatus.ACTIVE, reason, "Unfrozen by administrator");
    }

    @Override
    @Transactional
    public AccountResponse closeAccount(UUID accountId, String reason) {
        return changeStatus(accountId, AccountStatus.CLOSED, reason, "Closed on request");
    }

    /**
     * Shared logic of freeze/unfreeze/close. Locks the balance row first (same lock order as the
     * balance-update consumer) so no money can move while the status is changing.
     */
    private AccountResponse changeStatus(UUID accountId, AccountStatus target, String reason, String defaultReason) {
        AccountBalance balance = accountBalanceRepository.findByIdForUpdate(accountId)
                .orElseThrow(() -> new AccountNotFoundException(accountId.toString()));
        Account account = balance.getAccount();
        AuthenticatedUser user = CurrentUser.require();
        CurrentUser.requireOwnerOrAdmin(account.getCustomerId());

        accountValidator.requireTransition(account, target);
        if (target == AccountStatus.CLOSED) {
            accountValidator.requireZeroBalance(balance);
        }

        AccountStatus previous = account.getStatus();
        String effectiveReason = StringUtils.hasText(reason) ? reason.trim() : defaultReason;
        account.setStatus(target);
        Account saved = accountRepository.save(account);
        recordHistory(saved, previous, target, effectiveReason, user.userId());

        eventProducer.publish(AccountStatusChangedEvent.builder()
                .accountId(saved.getId().toString())
                .accountNumber(saved.getAccountNumber())
                .customerId(saved.getCustomerId())
                .customerEmail(saved.getCustomerEmail())
                .customerName(saved.getCustomerName())
                .previousStatus(previous.name())
                .newStatus(target.name())
                .reason(effectiveReason)
                .changedBy(user.userId())
                .build(), AccountEventProducer.AGGREGATE_ACCOUNT);

        log.info("Account {} status {} -> {} by {} ({})", MaskingUtil.maskAccountNumber(saved.getAccountNumber()),
                previous, target, user.userId(), effectiveReason);
        return accountMapper.toResponse(saved);
    }

    private Account findAccount(UUID accountId) {
        return accountRepository.findWithBalanceById(accountId)
                .orElseThrow(() -> new AccountNotFoundException(accountId.toString()));
    }

    private void recordHistory(Account account, AccountStatus previous, AccountStatus next, String reason,
                               String changedBy) {
        statusHistoryRepository.save(AccountStatusHistory.builder()
                .accountId(account.getId())
                .previousStatus(previous)
                .newStatus(next)
                .reason(reason)
                .changedBy(changedBy)
                .build());
    }
}

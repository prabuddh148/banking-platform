package com.banking.account.mapper;

import com.banking.account.dto.response.AccountBalanceResponse;
import com.banking.account.dto.response.AccountResponse;
import com.banking.account.dto.response.AccountSummaryResponse;
import com.banking.account.entity.Account;
import com.banking.account.entity.AccountBalance;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.ReportingPolicy;

/**
 * Entity -> DTO conversion. MapStruct generates the implementation ({@code AccountMapperImpl})
 * at compile time; {@code componentModel = "spring"} makes it a Spring bean we can inject.
 * Fields with the same name are copied automatically; the {@code @Mapping}s handle the rest.
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface AccountMapper {

    @Mapping(target = "balance", source = "balance.ledgerBalance")
    @Mapping(target = "availableBalance", source = "balance.availableBalance")
    AccountResponse toResponse(Account account);

    @Mapping(target = "balance", source = "balance.ledgerBalance")
    AccountSummaryResponse toSummary(Account account);

    @Mapping(target = "accountNumber", source = "account.accountNumber")
    AccountBalanceResponse toBalanceResponse(AccountBalance balance);
}

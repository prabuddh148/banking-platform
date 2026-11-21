package com.banking.common;

import com.banking.common.dto.ApiResponse;
import com.banking.common.dto.PagedResponse;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.JwtUtil;
import com.banking.common.security.SecurityConstants;
import com.banking.common.util.MaskingUtil;
import com.banking.common.util.MoneyUtil;
import com.banking.common.validation.CurrencyValidator;
import com.banking.common.validation.IbanValidator;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CommonLibraryTest {

    private static final String SECRET = "test-secret-that-is-at-least-32-bytes-long!!";

    @Test
    void masksSensitiveValues() {
        assertThat(MaskingUtil.maskAccountNumber("ACC1234567890")).isEqualTo("*********7890");
        assertThat(MaskingUtil.maskEmail("rahul@example.com")).isEqualTo("r****@example.com");
        assertThat(MaskingUtil.maskPhone("9876543210")).isEqualTo("******3210");
        assertThat(MaskingUtil.maskAccountNumber(null)).isNull();
    }

    @Test
    void moneyMathUsesTwoDecimals() {
        assertThat(MoneyUtil.add(new BigDecimal("10.005"), new BigDecimal("0.10"))).isEqualByComparingTo("10.10");
        assertThat(MoneyUtil.hasSufficientFunds(new BigDecimal("100"), new BigDecimal("100.00"))).isTrue();
        assertThat(MoneyUtil.hasSufficientFunds(new BigDecimal("99.99"), new BigDecimal("100"))).isFalse();
    }

    @Test
    void validatesIbanAndCurrency() {
        assertThat(IbanValidator.isValidIban("GB82 WEST 1234 5698 7654 32")).isTrue();
        assertThat(IbanValidator.isValidIban("GB82 WEST 1234 5698 7654 33")).isFalse();
        assertThat(CurrencyValidator.isSupported("inr")).isTrue();
        assertThat(CurrencyValidator.isSupported("XYZ")).isFalse();
    }

    @Test
    void jwtRoundTrip() {
        JwtUtil jwt = new JwtUtil(SECRET, Duration.ofMinutes(5));
        AuthenticatedUser user = new AuthenticatedUser("CUST-1", "rahul", "rahul@example.com", "Rahul",
                List.of(SecurityConstants.ROLE_CUSTOMER));

        AuthenticatedUser parsed = jwt.parseToken(jwt.generateToken(user));

        assertThat(parsed).isEqualTo(user);
        assertThat(parsed.isAdmin()).isFalse();
        assertThat(JwtUtil.extractBearerToken("Bearer abc")).isEqualTo("abc");
    }

    @Test
    void rejectsTamperedOrExpiredTokens() {
        JwtUtil jwt = new JwtUtil(SECRET, Duration.ofSeconds(-1));
        String expired = jwt.generateToken(new AuthenticatedUser("1", "u", null, null, List.of()));
        assertThatThrownBy(() -> jwt.parseToken(expired))
                .isInstanceOf(BankingException.class)
                .extracting("errorCode").isEqualTo(ErrorCode.TOKEN_EXPIRED);

        JwtUtil other = new JwtUtil(SECRET.replace('t', 'x'), Duration.ofMinutes(5));
        String foreign = other.generateToken(new AuthenticatedUser("1", "u", null, null, List.of()));
        assertThat(new JwtUtil(SECRET, Duration.ofMinutes(5)).isValid(foreign)).isFalse();
    }

    @Test
    void responsesHoldDataOrError() {
        ApiResponse<String> ok = ApiResponse.success("hi");
        assertThat(ok.isSuccess()).isTrue();
        ApiResponse<Void> err = ApiResponse.error(ErrorCode.ACCOUNT_NOT_FOUND, "nope");
        assertThat(err.getError().getStatus()).isEqualTo(404);
        assertThat(err.getError().getCode()).isEqualTo("ACCOUNT_NOT_FOUND");

        PagedResponse<Integer> page = new PagedResponse<>(List.of(1, 2), 0, 2, 5);
        assertThat(page.getTotalPages()).isEqualTo(3);
        assertThat(page.isLast()).isFalse();
    }
}

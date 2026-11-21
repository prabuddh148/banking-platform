package com.banking.account.entity;

import com.banking.common.util.MoneyUtil;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapsId;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UpdateTimestamp;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Money held in an account.
 * <ul>
 *   <li>ledgerBalance  - the real booked balance.</li>
 *   <li>reservedAmount - money on hold (see reserve/release).</li>
 *   <li>available      - ledgerBalance - reservedAmount (what can be spent right now).</li>
 * </ul>
 * Shares its primary key with {@link Account} ({@code @MapsId}).
 */
@Entity
@Table(name = "account_balances")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AccountBalance {

    /** Same value as the account id. */
    @Id
    @Column(name = "account_id")
    private UUID accountId;

    @MapsId
    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "account_id")
    private Account account;

    @Builder.Default
    @Column(name = "ledger_balance", nullable = false, precision = 19, scale = 2)
    private BigDecimal ledgerBalance = MoneyUtil.ZERO;

    @Builder.Default
    @Column(name = "reserved_amount", nullable = false, precision = 19, scale = 2)
    private BigDecimal reservedAmount = MoneyUtil.ZERO;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @UpdateTimestamp
    @Column(name = "last_updated", nullable = false)
    private Instant lastUpdated;

    @Version
    @Column(name = "version", nullable = false)
    private Long version;

    /** Money that can be spent right now. Computed, not stored. */
    public BigDecimal getAvailableBalance() {
        return MoneyUtil.subtract(ledgerBalance, reservedAmount);
    }

    public void credit(BigDecimal amount) {
        this.ledgerBalance = MoneyUtil.add(ledgerBalance, amount);
        touch();
    }

    public void debit(BigDecimal amount) {
        this.ledgerBalance = MoneyUtil.subtract(ledgerBalance, amount);
        touch();
    }

    public void reserve(BigDecimal amount) {
        this.reservedAmount = MoneyUtil.add(reservedAmount, amount);
        touch();
    }

    public void release(BigDecimal amount) {
        BigDecimal result = MoneyUtil.subtract(reservedAmount, amount);
        this.reservedAmount = MoneyUtil.isNegative(result) ? MoneyUtil.ZERO : result;
        touch();
    }

    private void touch() {
        this.lastUpdated = Instant.now();
    }
}

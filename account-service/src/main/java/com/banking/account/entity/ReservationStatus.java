package com.banking.account.entity;

/**
 * State of a hold (reservation) on an account's funds.
 * ACTIVE   - money is held (reduces the available balance).
 * RELEASED - hold removed by an admin; money is available again.
 * CONSUMED - the matching transaction actually debited the money.
 */
public enum ReservationStatus {
    ACTIVE,
    RELEASED,
    CONSUMED
}

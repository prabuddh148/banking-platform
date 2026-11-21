package com.banking.common.util;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/**
 * Date/time helpers. The platform stores everything in UTC and shows it in IST.
 */
public final class DateTimeUtil {

    public static final ZoneId UTC = ZoneOffset.UTC;
    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    public static final DateTimeFormatter DISPLAY_FORMAT = DateTimeFormatter.ofPattern("dd MMM yyyy, hh:mm a");

    private DateTimeUtil() {
    }

    public static Instant now() {
        return Instant.now();
    }

    public static LocalDateTime nowUtc() {
        return LocalDateTime.now(UTC);
    }

    public static LocalDateTime toIst(Instant instant) {
        return instant == null ? null : LocalDateTime.ofInstant(instant, IST);
    }

    public static String formatForDisplay(Instant instant) {
        return instant == null ? "" : DISPLAY_FORMAT.format(toIst(instant));
    }

    public static String formatIso(Instant instant) {
        return instant == null ? null : DateTimeFormatter.ISO_INSTANT.format(instant);
    }

    /** Start of the given day in IST, as an Instant. */
    public static Instant startOfDayIst(LocalDate date) {
        return date.atStartOfDay(IST).toInstant();
    }

    public static boolean isOlderThan(Instant instant, Duration duration) {
        return instant != null && instant.isBefore(Instant.now().minus(duration));
    }

    public static boolean isWithinLast(Instant instant, Duration duration) {
        return instant != null && !isOlderThan(instant, duration);
    }

    /** Hour of day (0-23) in IST, used e.g. by fraud rules for odd-hour checks. */
    public static int hourOfDayIst(Instant instant) {
        return toIst(instant).getHour();
    }
}

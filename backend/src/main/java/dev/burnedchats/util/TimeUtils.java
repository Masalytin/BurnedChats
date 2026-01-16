package dev.burnedchats.util;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/**
 * Time and duration utility methods.
 */
public final class TimeUtils {

    private static final DateTimeFormatter ISO_FORMATTER =
            DateTimeFormatter.ISO_INSTANT.withZone(ZoneOffset.UTC);

    private TimeUtils() {
        // Utility class, no instantiation
    }

    /**
     * Get current timestamp as Unix epoch seconds.
     *
     * @return current Unix timestamp
     */
    public static long nowEpochSeconds() {
        return Instant.now().getEpochSecond();
    }

    /**
     * Get current timestamp as Unix epoch milliseconds.
     *
     * @return current Unix timestamp in milliseconds
     */
    public static long nowEpochMillis() {
        return Instant.now().toEpochMilli();
    }

    /**
     * Check if a timestamp is within the specified duration from now.
     *
     * @param epochSeconds Unix timestamp in seconds
     * @param maxAge       maximum age duration
     * @return true if timestamp is within maxAge from now
     */
    public static boolean isWithinAge(long epochSeconds, Duration maxAge) {
        Instant timestamp = Instant.ofEpochSecond(epochSeconds);
        Instant cutoff = Instant.now().minus(maxAge);
        return timestamp.isAfter(cutoff);
    }

    /**
     * Check if an Instant is within the specified duration from now.
     *
     * @param instant the instant to check
     * @param maxAge  maximum age duration
     * @return true if instant is within maxAge from now
     */
    public static boolean isWithinAge(Instant instant, Duration maxAge) {
        if (instant == null) {
            return false;
        }
        Instant cutoff = Instant.now().minus(maxAge);
        return instant.isAfter(cutoff);
    }

    /**
     * Format an Instant as ISO-8601 string.
     *
     * @param instant the instant to format
     * @return ISO-8601 formatted string
     */
    public static String formatIso(Instant instant) {
        if (instant == null) {
            return null;
        }
        return ISO_FORMATTER.format(instant);
    }

    /**
     * Parse an ISO-8601 string to Instant.
     *
     * @param isoString the ISO-8601 string
     * @return parsed Instant, or null if parsing fails
     */
    public static Instant parseIso(String isoString) {
        if (isoString == null || isoString.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(isoString);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Calculate duration between two instants.
     *
     * @param start start instant
     * @param end   end instant
     * @return duration between start and end
     */
    public static Duration between(Instant start, Instant end) {
        if (start == null || end == null) {
            return Duration.ZERO;
        }
        return Duration.between(start, end);
    }

    /**
     * Format duration as human-readable string.
     *
     * @param duration the duration to format
     * @return formatted string (e.g., "5m 30s", "2h 15m")
     */
    public static String formatDuration(Duration duration) {
        if (duration == null || duration.isNegative()) {
            return "0s";
        }

        long hours = duration.toHours();
        long minutes = duration.toMinutesPart();
        long seconds = duration.toSecondsPart();

        StringBuilder sb = new StringBuilder();
        if (hours > 0) {
            sb.append(hours).append("h ");
        }
        if (minutes > 0 || hours > 0) {
            sb.append(minutes).append("m ");
        }
        sb.append(seconds).append("s");

        return sb.toString().trim();
    }
}




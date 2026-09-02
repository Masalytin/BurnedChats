package dev.burnedchats.util;

/**
 * Coarse last-seen rounding shared by DM and room presence (privacy).
 */
public final class PresenceTimestamps {

    private static final long MINUTE_MS = 60_000L;

    private PresenceTimestamps() {
    }

    public static long roundToMinute(long epochMs) {
        return (epochMs / MINUTE_MS) * MINUTE_MS;
    }

    public static long nowRoundedToMinute() {
        return roundToMinute(System.currentTimeMillis());
    }
}

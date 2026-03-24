package dev.burnedchats.util;

/**
 * Application-wide validation constants.
 *
 * <p>Centralizes size limits, rate limits, and other validation
 * thresholds used across the application.
 */
public final class ValidationConstants {

    private ValidationConstants() {}

    /**
     * Maximum encrypted file size in bytes (25 MB + AES-GCM overhead).
     * IV (12 bytes) + tag (16 bytes) = 28 bytes overhead, negligible.
     */
    public static final long MAX_ENCRYPTED_FILE_SIZE = 25 * 1024 * 1024 + 28;

    /** Maximum file uploads per user per minute. */
    public static final int FILE_UPLOAD_RATE_LIMIT = 10;

    /** Valid context types for file uploads. */
    public static final String CONTEXT_TYPE_SESSION = "session";
    public static final String CONTEXT_TYPE_ROOM = "room";
}

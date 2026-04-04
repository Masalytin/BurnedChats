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
     * Maximum encrypted blob size in bytes accepted by the server.
     * Plaintext may be up to 25 MB; chunked AES-GCM adds IV+tag per chunk and a small header,
     * so the encrypted blob ceiling is set slightly above 25 MB.
     */
    public static final long MAX_ENCRYPTED_FILE_SIZE = 26 * 1024 * 1024;

    /** Maximum file uploads per user per minute. */
    public static final int FILE_UPLOAD_RATE_LIMIT = 10;

    /** Valid context types for file uploads. */
    public static final String CONTEXT_TYPE_SESSION = "session";
    public static final String CONTEXT_TYPE_ROOM = "room";
}

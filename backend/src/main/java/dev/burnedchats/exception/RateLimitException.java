package dev.burnedchats.exception;

import java.time.Duration;

/**
 * Exception thrown when rate limit is exceeded.
 */
public class RateLimitException extends BurnedChatsException {

    private static final long serialVersionUID = 1L;

    private final Duration retryAfter;

    /**
     * Create rate limit exception.
     *
     * @param message    error message
     * @param retryAfter duration until rate limit resets
     */
    public RateLimitException(String message, Duration retryAfter) {
        super(message, "RATE_LIMIT_EXCEEDED");
        this.retryAfter = retryAfter;
    }

    /**
     * Create rate limit exception with default message.
     *
     * @param retryAfter duration until rate limit resets
     */
    public RateLimitException(Duration retryAfter) {
        this("Rate limit exceeded. Please try again later.", retryAfter);
    }

    /**
     * Get the duration until the rate limit resets.
     *
     * @return retry after duration
     */
    public Duration getRetryAfter() {
        return retryAfter;
    }

    /**
     * Get retry after in seconds.
     *
     * @return seconds until rate limit resets
     */
    public long getRetryAfterSeconds() {
        return retryAfter != null ? retryAfter.getSeconds() : 60;
    }
}




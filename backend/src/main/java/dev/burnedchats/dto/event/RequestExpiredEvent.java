package dev.burnedchats.dto.event;

import lombok.Builder;
import lombok.Getter;

import java.time.Instant;

/**
 * Event sent to the initiator when their chat request expires.
 *
 * <p>This event is triggered when:
 * <ul>
 *   <li>The 5-minute TTL expires in Redis</li>
 *   <li>The recipient explicitly rejects the request</li>
 *   <li>The system detects an expired request during processing</li>
 * </ul>
 *
 * @see dev.burnedchats.handler.SessionHandler
 */
@Getter
@Builder
public class RequestExpiredEvent {

    /**
     * Session ID that expired.
     */
    private final String sessionId;

    /**
     * Reason for expiration.
     */
    private final ExpireReason reason;

    /**
     * Server timestamp when event was generated.
     */
    @Builder.Default
    private final Instant timestamp = Instant.now();

    /**
     * Reason why the request expired/ended.
     */
    public enum ExpireReason {
        /**
         * TTL expired (5 minutes passed).
         */
        TIMEOUT,

        /**
         * Recipient rejected the request.
         */
        REJECTED,

        /**
         * Initiator cancelled the request.
         */
        CANCELLED,

        /**
         * Session was burned.
         */
        BURNED
    }

    /**
     * Create event for timeout expiration.
     */
    public static RequestExpiredEvent timeout(String sessionId) {
        return RequestExpiredEvent.builder()
                .sessionId(sessionId)
                .reason(ExpireReason.TIMEOUT)
                .build();
    }

    /**
     * Create event for rejection.
     */
    public static RequestExpiredEvent rejected(String sessionId) {
        return RequestExpiredEvent.builder()
                .sessionId(sessionId)
                .reason(ExpireReason.REJECTED)
                .build();
    }

    /**
     * Create event for cancellation.
     */
    public static RequestExpiredEvent cancelled(String sessionId) {
        return RequestExpiredEvent.builder()
                .sessionId(sessionId)
                .reason(ExpireReason.CANCELLED)
                .build();
    }
}

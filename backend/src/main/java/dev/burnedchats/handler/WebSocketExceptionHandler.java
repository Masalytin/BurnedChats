package dev.burnedchats.handler;

import dev.burnedchats.exception.PowInvalidException;
import dev.burnedchats.exception.PowRequiredException;
import dev.burnedchats.exception.RateLimitException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.web.bind.annotation.ControllerAdvice;

import java.time.Instant;
import java.util.Map;

/**
 * Global exception handler for WebSocket/STOMP messaging.
 *
 * <p>Handles exceptions thrown during message processing and
 * sends appropriate error responses to the user.
 */
@Slf4j
@ControllerAdvice
public class WebSocketExceptionHandler {

    /**
     * Handle RateLimitException (5.1.6).
     *
     * <p>Sends an error response with retry-after information.
     *
     * @param exception the rate limit exception
     * @return error response map
     */
    @MessageExceptionHandler(RateLimitException.class)
    @SendToUser("/queue/errors")
    public Map<String, Object> handleRateLimitException(RateLimitException exception) {
        LOG.warn("Rate limit exceeded: {}", exception.getMessage());

        return Map.of(
                "success", false,
                "error", "RATE_LIMIT_EXCEEDED",
                "message", exception.getMessage(),
                "retryAfter", exception.getRetryAfterSeconds(),
                "timestamp", Instant.now().toString()
        );
    }

    /**
     * Handle missing or expired PoW challenge on gated actions.
     */
    @MessageExceptionHandler(PowRequiredException.class)
    @SendToUser("/queue/errors")
    public Map<String, Object> handlePowRequiredException(PowRequiredException exception) {
        LOG.debug("PoW required: {}", exception.getMessage());

        return Map.of(
                "success", false,
                "error", "POW_REQUIRED",
                "message", exception.getMessage(),
                "timestamp", Instant.now().toString()
        );
    }

    /**
     * Handle invalid PoW solution (wrong hash, action mismatch, replay).
     */
    @MessageExceptionHandler(PowInvalidException.class)
    @SendToUser("/queue/errors")
    public Map<String, Object> handlePowInvalidException(PowInvalidException exception) {
        LOG.debug("PoW invalid: {}", exception.getMessage());

        return Map.of(
                "success", false,
                "error", "POW_INVALID",
                "message", exception.getMessage(),
                "timestamp", Instant.now().toString()
        );
    }

    /**
     * Handle generic exceptions.
     *
     * @param exception the exception
     * @return error response map
     */
    @MessageExceptionHandler(Exception.class)
    @SendToUser("/queue/errors")
    public Map<String, Object> handleException(Exception exception) {
        LOG.error("Unhandled WebSocket exception: {}", exception.getMessage(), exception);

        return Map.of(
                "success", false,
                "error", "INTERNAL_ERROR",
                "message", "An unexpected error occurred",
                "timestamp", Instant.now().toString()
        );
    }
}

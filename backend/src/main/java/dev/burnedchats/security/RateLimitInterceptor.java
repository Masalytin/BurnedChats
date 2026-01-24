package dev.burnedchats.security;

import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.service.RateLimitService;
import dev.burnedchats.service.RateLimitService.RateLimitType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.lang.NonNull;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;

import java.security.Principal;
import java.util.Map;

/**
 * Channel interceptor for rate limiting STOMP messages (5.1.6).
 *
 * <p>Applies rate limits to different types of requests:
 * <ul>
 *   <li>Search requests: 10/min</li>
 *   <li>Session creation: 3/min</li>
 *   <li>Messages: 60/min</li>
 *   <li>Session actions: 10/min</li>
 * </ul>
 *
 * <p>Rate limit violations result in a RateLimitException being thrown,
 * which should be handled by the error handler.
 *
 * @see RateLimitService
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RateLimitInterceptor implements ChannelInterceptor {

    private final RateLimitService rateLimitService;

    /**
     * Mapping of STOMP destinations to rate limit types.
     */
    private static final Map<String, RateLimitType> DESTINATION_RATE_LIMITS = Map.of(
            "/app/search", RateLimitType.SEARCH,
            "/app/session.create", RateLimitType.SESSION_CREATE,
            "/app/session.accept", RateLimitType.SESSION_ACTION,
            "/app/session.reject", RateLimitType.SESSION_ACTION,
            "/app/message.send", RateLimitType.MESSAGE,
            "/app/message.sync", RateLimitType.MESSAGE,
            "/app/handshake.key", RateLimitType.HANDSHAKE,
            "/app/verification.confirm", RateLimitType.SESSION_ACTION
    );

    @Override
    public Message<?> preSend(@NonNull Message<?> message, @NonNull MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);

        if (accessor == null || accessor.getCommand() != StompCommand.SEND) {
            return message;
        }

        String destination = accessor.getDestination();
        if (destination == null) {
            return message;
        }

        // Get the rate limit type for this destination
        RateLimitType rateLimitType = DESTINATION_RATE_LIMITS.get(destination);
        if (rateLimitType == null) {
            // Apply general rate limit for unknown destinations
            rateLimitType = RateLimitType.GENERAL;
        }

        // Get user ID from principal
        Principal principal = accessor.getUser();
        if (principal == null) {
            // No principal, skip rate limiting (auth interceptor should have rejected)
            return message;
        }

        Long userId = extractUserId(principal);
        if (userId == null) {
            return message;
        }

        // Check rate limit
        try {
            rateLimitService.checkRateLimitBlocking(userId, rateLimitType);
            return message;
        } catch (RateLimitException e) {
            log.warn("Rate limit exceeded for user {} on {}: retry after {}s",
                    userId, destination, e.getRetryAfterSeconds());
            throw e;
        }
    }

    /**
     * Extract user ID from principal.
     */
    private Long extractUserId(Principal principal) {
        if (principal instanceof StompAuthInterceptor.TelegramPrincipal telegramPrincipal) {
            return telegramPrincipal.getUserId();
        }
        return null;
    }
}

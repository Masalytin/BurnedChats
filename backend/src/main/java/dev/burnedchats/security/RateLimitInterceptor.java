package dev.burnedchats.security;

import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.handler.WebSocketExceptionHandler;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.metrics.StompDeliveryMetrics;
import dev.burnedchats.service.RateLimitService;
import dev.burnedchats.service.RateLimitService.RateLimitType;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.lang.NonNull;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;
import reactor.core.scheduler.Schedulers;

import java.security.Principal;
import java.time.Duration;
import java.util.Map;

/**
 * Channel interceptor for rate limiting STOMP messages (5.1.6).
 *
 * <p>Applies rate limits to different types of requests. When a limit is exceeded on
 * {@link StompCommand#SEND}, the frame is dropped ({@code null}) and a structured
 * {@code RATE_LIMIT_EXCEEDED} payload is sent to {@code /user/queue/errors} so the
 * WebSocket stays open (STOMP ERROR would close the connection).
 *
 * @see RateLimitService
 */
@Slf4j
@Component
public class RateLimitInterceptor implements ChannelInterceptor {

    private static final Duration RATE_LIMIT_TIMEOUT = Duration.ofSeconds(30);
    private static final String ERRORS_DESTINATION = "/queue/errors";
    private static final String HEARTBEAT_DESTINATION = "/app/heartbeat";

    private final RateLimitService rateLimitService;
    private final StompUserMessenger stompUserMessenger;
    private final WebSocketExceptionHandler webSocketExceptionHandler;
    private final StompDeliveryMetrics stompDeliveryMetrics;

    /**
     * {@code StompUserMessenger} is injected lazily to break the startup cycle:
     * it needs {@code SimpMessagingTemplate} from the broker configuration, which in turn
     * needs {@link dev.burnedchats.config.WebSocketConfig} → this interceptor. Same pattern
     * as {@link RoomTopicSubscribeInterceptor}'s lazy {@code clientOutboundChannel}.
     */
    public RateLimitInterceptor(
            RateLimitService rateLimitService,
            @Lazy StompUserMessenger stompUserMessenger,
            WebSocketExceptionHandler webSocketExceptionHandler) {
        this(rateLimitService, stompUserMessenger, webSocketExceptionHandler, null);
    }

    @org.springframework.beans.factory.annotation.Autowired
    public RateLimitInterceptor(
            RateLimitService rateLimitService,
            @Lazy StompUserMessenger stompUserMessenger,
            WebSocketExceptionHandler webSocketExceptionHandler,
            @org.springframework.lang.Nullable StompDeliveryMetrics stompDeliveryMetrics) {
        this.rateLimitService = rateLimitService;
        this.stompUserMessenger = stompUserMessenger;
        this.webSocketExceptionHandler = webSocketExceptionHandler;
        this.stompDeliveryMetrics = stompDeliveryMetrics;
    }

    /**
     * Mapping of STOMP destinations to rate limit types.
     */
    private static final Map<String, RateLimitType> DESTINATION_RATE_LIMITS = Map.ofEntries(
            Map.entry("/app/search", RateLimitType.SEARCH),
            // session.create: rate limit applied in SessionHandler after PoW (DESIGN.md §6.2)
            Map.entry("/app/session.accept", RateLimitType.SESSION_ACTION),
            Map.entry("/app/session.reject", RateLimitType.SESSION_ACTION),
            Map.entry("/app/message.send", RateLimitType.MESSAGE),
            Map.entry("/app/message.sync", RateLimitType.MESSAGE),
            Map.entry("/app/room.message.send", RateLimitType.MESSAGE),
            Map.entry("/app/room.message.sync", RateLimitType.MESSAGE),
            Map.entry("/app/message.edit", RateLimitType.MESSAGE_EDIT),
            Map.entry("/app/room.message.edit", RateLimitType.MESSAGE_EDIT),
            Map.entry("/app/message.delete", RateLimitType.MESSAGE_DELETE),
            Map.entry("/app/room.message.delete", RateLimitType.MESSAGE_DELETE),
            Map.entry("/app/handshake.key", RateLimitType.HANDSHAKE),
            Map.entry("/app/verification.confirm", RateLimitType.SESSION_ACTION),
            Map.entry("/app/room.getMembers", RateLimitType.ROOM_READ),
            Map.entry("/app/room.getPresence", RateLimitType.ROOM_READ),
            Map.entry("/app/room.getBans", RateLimitType.ROOM_READ)
            // dmInvite.mint / dmInvite.redeem: dedicated limits in DmInviteService (IMP-DMINVITE-01)
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

        if (HEARTBEAT_DESTINATION.equals(destination)) {
            return message;
        }

        RateLimitType rateLimitType = DESTINATION_RATE_LIMITS.get(destination);
        if (rateLimitType == null) {
            rateLimitType = RateLimitType.GENERAL;
        }

        Principal principal = accessor.getUser();
        if (principal == null) {
            return message;
        }

        if (!(principal instanceof AppPrincipal appPrincipal)) {
            return message;
        }

        String userId = appPrincipal.getInternalId();
        if (userId == null) {
            return message;
        }

        try {
            awaitRateLimit(userId, rateLimitType);
            if (stompDeliveryMetrics != null) {
                stompDeliveryMetrics.incrementAccepted();
            }
            return message;
        } catch (RateLimitException e) {
            LOG.warn("Rate limit exceeded for user {} on {}: retry after {}s",
                    userId, destination, e.getRetryAfterSeconds());
            if (stompDeliveryMetrics != null) {
                stompDeliveryMetrics.incrementDropped();
            }
            publishRateLimitError(appPrincipal, e);
            return null;
        }
    }

    private void publishRateLimitError(AppPrincipal principal, RateLimitException exception) {
        Map<String, Object> payload = webSocketExceptionHandler.handleRateLimitException(exception);
        try {
            stompUserMessenger.convertAndSendToUser(principal, ERRORS_DESTINATION, payload);
        } catch (Exception sendError) {
            LOG.warn("Failed to publish rate limit error for user {}: {}",
                    principal.getInternalId(), sendError.getMessage());
        }
    }

    /**
     * Runs reactive rate-limit check off the inbound broker thread; preSend stays synchronous
     * per Spring STOMP API (same trade-off as {@link StompAuthInterceptor#awaitAuth}).
     */
    private void awaitRateLimit(String userId, RateLimitType rateLimitType) {
        try {
            rateLimitService.enforceRateLimit(userId, rateLimitType)
                    .subscribeOn(Schedulers.boundedElastic())
                    .block(RATE_LIMIT_TIMEOUT);
        } catch (RateLimitException e) {
            throw e;
        } catch (RuntimeException e) {
            Throwable cause = e.getCause();
            if (cause instanceof RateLimitException rateLimitEx) {
                throw rateLimitEx;
            }
            throw e;
        }
    }
}

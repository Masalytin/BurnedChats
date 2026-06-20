package dev.burnedchats.security;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.exception.RoomSubscribeDeniedException;
import dev.burnedchats.repository.RoomMembersRepository;
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
import reactor.core.scheduler.Schedulers;

import java.security.Principal;
import java.time.Duration;

/**
 * Inbound STOMP interceptor that enforces room membership on
 * {@code SUBSCRIBE /topic/room/{roomId}}.
 *
 * <p>Defense-in-depth after kick/ban: removed members cannot re-subscribe to the room
 * topic and receive ciphertext until client-driven rekey completes for remaining members.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RoomTopicSubscribeInterceptor implements ChannelInterceptor {

    /** Must match {@link dev.burnedchats.handler.RoomMessageHandler} fan-out prefix. */
    public static final String ROOM_TOPIC_PREFIX = "/topic/room/";

    private static final Duration MEMBERSHIP_CHECK_TIMEOUT = Duration.ofSeconds(5);

    private final RoomMembersRepository roomMembersRepository;

    @Override
    public Message<?> preSend(@NonNull Message<?> message, @NonNull MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getCommand() != StompCommand.SUBSCRIBE) {
            return message;
        }

        String destination = accessor.getDestination();
        if (destination == null || !destination.startsWith(ROOM_TOPIC_PREFIX)) {
            return message;
        }

        String roomId = destination.substring(ROOM_TOPIC_PREFIX.length());
        if (roomId.isBlank() || roomId.contains("/")) {
            LOG.warn("Rejected room topic subscribe: invalid destination {}", destination);
            throw new RoomSubscribeDeniedException("SUBSCRIBE_DENIED: invalid room topic destination",
                    "SUBSCRIBE_DENIED");
        }

        Principal principal = accessor.getUser();
        if (!(principal instanceof AppPrincipal appPrincipal)) {
            LOG.warn("Rejected room topic subscribe: missing principal, roomId={}", roomId);
            throw new AuthenticationException("Authentication required to subscribe to room topics");
        }

        String internalId = appPrincipal.getInternalId();
        awaitMembership(roomId, internalId, accessor.getSessionId());
        return message;
    }

    private void awaitMembership(String roomId, String internalId, String sessionId) {
        try {
            Boolean isMember = roomMembersRepository.isMember(roomId, internalId)
                    .subscribeOn(Schedulers.boundedElastic())
                    .block(MEMBERSHIP_CHECK_TIMEOUT);

            if (!Boolean.TRUE.equals(isMember)) {
                LOG.info("Room topic subscribe denied: sessionId={}, roomId={}, internalId={}",
                        sessionId, roomId, internalId);
                throw new RoomSubscribeDeniedException(roomId);
            }

            LOG.debug("Room topic subscribe allowed: sessionId={}, roomId={}, internalId={}",
                    sessionId, roomId, internalId);
        } catch (RoomSubscribeDeniedException e) {
            throw e;
        } catch (RuntimeException e) {
            LOG.error("Room membership check failed for subscribe roomId={}, internalId={}: {}",
                    roomId, internalId, e.getMessage());
            throw new RoomSubscribeDeniedException("SUBSCRIBE_DENIED: membership check failed",
                    "SUBSCRIBE_DENIED");
        }
    }
}

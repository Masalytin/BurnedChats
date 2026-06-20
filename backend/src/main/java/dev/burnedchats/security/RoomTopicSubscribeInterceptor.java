package dev.burnedchats.security;

import dev.burnedchats.exception.RoomSubscribeDeniedException;
import dev.burnedchats.repository.RoomMembersRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Lazy;
import org.springframework.lang.NonNull;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;
import reactor.core.scheduler.Schedulers;

import java.nio.charset.StandardCharsets;
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
public class RoomTopicSubscribeInterceptor implements ChannelInterceptor {

    /** Must match {@link dev.burnedchats.handler.RoomMessageHandler} fan-out prefix. */
    public static final String ROOM_TOPIC_PREFIX = "/topic/room/";

    private static final Duration MEMBERSHIP_CHECK_TIMEOUT = Duration.ofSeconds(5);

    private final RoomMembersRepository roomMembersRepository;
    private final MessageChannel clientOutboundChannel;

    public RoomTopicSubscribeInterceptor(
            RoomMembersRepository roomMembersRepository,
            @Lazy @Qualifier("clientOutboundChannel") MessageChannel clientOutboundChannel) {
        this.roomMembersRepository = roomMembersRepository;
        this.clientOutboundChannel = clientOutboundChannel;
    }

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
            denySubscribe(accessor.getSessionId(),
                    new RoomSubscribeDeniedException("SUBSCRIBE_DENIED: invalid room topic destination",
                            "SUBSCRIBE_DENIED").getMessage());
            return null;
        }

        Principal principal = accessor.getUser();
        if (!(principal instanceof AppPrincipal appPrincipal)) {
            LOG.warn("Rejected room topic subscribe: missing principal, roomId={}", roomId);
            denySubscribe(accessor.getSessionId(),
                    "AUTH_ERROR: Authentication required to subscribe to room topics");
            return null;
        }

        String internalId = appPrincipal.getInternalId();
        if (!isMember(roomId, internalId, accessor.getSessionId())) {
            return null;
        }
        return message;
    }

    private boolean isMember(String roomId, String internalId, String sessionId) {
        try {
            Boolean isMember = roomMembersRepository.isMember(roomId, internalId)
                    .subscribeOn(Schedulers.boundedElastic())
                    .block(MEMBERSHIP_CHECK_TIMEOUT);

            if (!Boolean.TRUE.equals(isMember)) {
                LOG.info("Room topic subscribe denied: sessionId={}, roomId={}, internalId={}",
                        sessionId, roomId, internalId);
                denySubscribe(sessionId, new RoomSubscribeDeniedException(roomId).getMessage());
                return false;
            }

            LOG.debug("Room topic subscribe allowed: sessionId={}, roomId={}, internalId={}",
                    sessionId, roomId, internalId);
            return true;
        } catch (RuntimeException e) {
            LOG.error("Room membership check failed for subscribe roomId={}, internalId={}: {}",
                    roomId, internalId, e.getMessage());
            denySubscribe(sessionId, new RoomSubscribeDeniedException("SUBSCRIBE_DENIED: membership check failed",
                    "SUBSCRIBE_DENIED").getMessage());
            return false;
        }
    }

    private void denySubscribe(String sessionId, String errorMessage) {
        publishSubscribeDeniedError(sessionId, errorMessage);
    }

    private void publishSubscribeDeniedError(String sessionId, String errorMessage) {
        if (sessionId == null || errorMessage == null) {
            LOG.warn("Subscribe denial STOMP ERROR skipped: missing sessionId or message");
            return;
        }

        StompHeaderAccessor errorAccessor = StompHeaderAccessor.create(StompCommand.ERROR);
        errorAccessor.setSessionId(sessionId);
        errorAccessor.setMessage(errorMessage);
        errorAccessor.setLeaveMutable(true);

        byte[] payload = errorMessage.getBytes(StandardCharsets.UTF_8);
        Message<byte[]> errorFrame = MessageBuilder.createMessage(payload, errorAccessor.getMessageHeaders());
        try {
            clientOutboundChannel.send(errorFrame);
            LOG.debug("Sent STOMP ERROR for subscribe denial: sessionId={}, message={}",
                    sessionId, errorMessage);
        } catch (Exception sendError) {
            LOG.warn("Failed to send STOMP ERROR for subscribe denial sessionId={}: {}",
                    sessionId, sendError.getMessage());
        }
    }
}

package dev.burnedchats.observability;

import dev.burnedchats.security.AppPrincipal;
import org.springframework.lang.NonNull;
import org.springframework.lang.Nullable;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;

import java.security.Principal;

/**
 * Puts allowlisted STOMP correlation fields into MDC for the inbound dispatch thread.
 */
@Component
public class CorrelationChannelInterceptor implements ChannelInterceptor {

    static final String ROOM_TOPIC_PREFIX = "/topic/room/";

    @Override
    public Message<?> preSend(@NonNull Message<?> message, @NonNull MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null) {
            return message;
        }
        CorrelationMdc.putSessionId(accessor.getSessionId());
        CorrelationMdc.putDestination(accessor.getDestination());
        CorrelationMdc.putRoomId(extractRoomId(accessor.getDestination()));
        Principal principal = accessor.getUser();
        if (principal instanceof AppPrincipal appPrincipal) {
            CorrelationMdc.putInternalId(appPrincipal.getInternalId());
        }
        return message;
    }

    @Override
    public void afterSendCompletion(
            @NonNull Message<?> message,
            @NonNull MessageChannel channel,
            boolean sent,
            @Nullable Exception ex) {
        CorrelationMdc.clear();
    }

    static String extractRoomId(String destination) {
        if (destination == null || !destination.startsWith(ROOM_TOPIC_PREFIX)) {
            return null;
        }
        String roomId = destination.substring(ROOM_TOPIC_PREFIX.length());
        int slash = roomId.indexOf('/');
        return slash < 0 ? roomId : roomId.substring(0, slash);
    }
}

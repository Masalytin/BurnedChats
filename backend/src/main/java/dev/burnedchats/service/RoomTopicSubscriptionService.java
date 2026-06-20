package dev.burnedchats.service;

import dev.burnedchats.security.RoomTopicSubscribeInterceptor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.broker.SubscriptionRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.simp.user.SimpSession;
import org.springframework.messaging.simp.user.SimpSubscription;
import org.springframework.messaging.simp.user.SimpUser;
import org.springframework.messaging.simp.user.SimpUserRegistry;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * Server-side removal of active STOMP subscriptions to {@code /topic/room/{roomId}}.
 *
 * <p>Complements {@link RoomTopicSubscribeInterceptor} (blocks new SUBSCRIBE after kick/leave)
 * by cutting off subscriptions that were opened before membership was revoked.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RoomTopicSubscriptionService {

    private final SimpUserRegistry userRegistry;
    private final SubscriptionRegistry subscriptionRegistry;

    /**
     * Unregisters all active room-topic subscriptions for the given user across every session.
     *
     * @param roomId     room identifier
     * @param internalId stable user id ({@link dev.burnedchats.security.AppPrincipal#getInternalId()})
     * @return number of subscriptions removed
     */
    public int unsubscribeUserFromRoomTopic(String roomId, String internalId) {
        if (!StringUtils.hasText(roomId) || !StringUtils.hasText(internalId)) {
            LOG.warn("Force-unsubscribe skipped: blank roomId or internalId");
            return 0;
        }

        String destination = RoomTopicSubscribeInterceptor.ROOM_TOPIC_PREFIX + roomId;
        SimpUser user = userRegistry.getUser(internalId);
        if (user == null) {
            LOG.debug("Force-unsubscribe: no active STOMP sessions for internalId={}, roomId={}",
                    internalId, roomId);
            return 0;
        }

        int removed = 0;
        for (SimpSession session : user.getSessions()) {
            for (SimpSubscription subscription : session.getSubscriptions()) {
                if (destination.equals(subscription.getDestination())) {
                    unregisterSubscription(session.getId(), subscription.getId());
                    removed++;
                    LOG.info("Force-unsubscribed room topic: sessionId={}, subscriptionId={}, "
                                    + "roomId={}, internalId={}",
                            session.getId(), subscription.getId(), roomId, internalId);
                }
            }
        }
        return removed;
    }

    private void unregisterSubscription(String sessionId, String subscriptionId) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.UNSUBSCRIBE);
        accessor.setSessionId(sessionId);
        accessor.setSubscriptionId(subscriptionId);
        accessor.setLeaveMutable(true);
        Message<byte[]> message = MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
        subscriptionRegistry.unregisterSubscription(message);
    }
}

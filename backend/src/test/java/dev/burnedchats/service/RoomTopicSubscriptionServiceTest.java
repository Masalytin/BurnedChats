package dev.burnedchats.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.broker.SubscriptionRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.simp.user.SimpSession;
import org.springframework.messaging.simp.user.SimpSubscription;
import org.springframework.messaging.simp.user.SimpUser;
import org.springframework.messaging.simp.user.SimpUserRegistry;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RoomTopicSubscriptionServiceTest {

    private static final String ROOM_ID = "room-force-unsub-1";
    private static final String INTERNAL_ID = "user-internal-1";
    private static final String ROOM_TOPIC = "/topic/room/" + ROOM_ID;
    private static final String OTHER_TOPIC = "/topic/other";
    private static final String USER_QUEUE = "/user/queue/notifications";

    @Mock
    private SimpUserRegistry userRegistry;
    @Mock
    private SubscriptionRegistry subscriptionRegistry;

    private RoomTopicSubscriptionService service;

    @BeforeEach
    void setUp() {
        service = new RoomTopicSubscriptionService(userRegistry, subscriptionRegistry);
    }

    @Test
    void unsubscribeUserFromRoomTopic_whenBlankArgs_returnsZero() {
        assertThat(service.unsubscribeUserFromRoomTopic("", INTERNAL_ID)).isZero();
        assertThat(service.unsubscribeUserFromRoomTopic(ROOM_ID, "  ")).isZero();
        verify(subscriptionRegistry, never()).unregisterSubscription(any());
    }

    @Test
    void unsubscribeUserFromRoomTopic_whenUserNotConnected_returnsZero() {
        when(userRegistry.getUser(INTERNAL_ID)).thenReturn(null);

        assertThat(service.unsubscribeUserFromRoomTopic(ROOM_ID, INTERNAL_ID)).isZero();

        verify(subscriptionRegistry, never()).unregisterSubscription(any());
    }

    @Test
    void unsubscribeUserFromRoomTopic_whenNoMatchingDestination_returnsZero() {
        SimpUser user = mock(SimpUser.class);
        SimpSession session = mock(SimpSession.class);
        SimpSubscription subscription = mock(SimpSubscription.class);
        when(userRegistry.getUser(INTERNAL_ID)).thenReturn(user);
        when(user.getSessions()).thenReturn(Set.of(session));
        when(session.getSubscriptions()).thenReturn(Set.of(subscription));
        when(subscription.getDestination()).thenReturn(OTHER_TOPIC);

        assertThat(service.unsubscribeUserFromRoomTopic(ROOM_ID, INTERNAL_ID)).isZero();

        verify(subscriptionRegistry, never()).unregisterSubscription(any());
    }

    @Test
    void unsubscribeUserFromRoomTopic_whenRoomTopicSubscribed_unregistersOnlyRoomTopic() {
        SimpUser user = mock(SimpUser.class);
        SimpSession session = mock(SimpSession.class);
        SimpSubscription roomSub = mock(SimpSubscription.class);
        SimpSubscription userQueueSub = mock(SimpSubscription.class);
        when(userRegistry.getUser(INTERNAL_ID)).thenReturn(user);
        when(user.getSessions()).thenReturn(Set.of(session));
        when(session.getId()).thenReturn("sess-1");
        when(session.getSubscriptions()).thenReturn(Set.of(roomSub, userQueueSub));
        when(roomSub.getDestination()).thenReturn(ROOM_TOPIC);
        when(roomSub.getId()).thenReturn("sub-room");
        when(userQueueSub.getDestination()).thenReturn(USER_QUEUE);

        assertThat(service.unsubscribeUserFromRoomTopic(ROOM_ID, INTERNAL_ID)).isEqualTo(1);

        ArgumentCaptor<Message<?>> captor = ArgumentCaptor.forClass(Message.class);
        verify(subscriptionRegistry).unregisterSubscription(captor.capture());
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(captor.getValue());
        assertThat(accessor.getCommand()).isEqualTo(StompCommand.UNSUBSCRIBE);
        assertThat(accessor.getSessionId()).isEqualTo("sess-1");
        assertThat(accessor.getSubscriptionId()).isEqualTo("sub-room");
    }

    @Test
    void unsubscribeUserFromRoomTopic_whenMultipleSessions_unregistersAllMatching() {
        SimpUser user = mock(SimpUser.class);
        SimpSession session1 = mock(SimpSession.class);
        SimpSession session2 = mock(SimpSession.class);
        SimpSubscription sub1 = mock(SimpSubscription.class);
        SimpSubscription sub2 = mock(SimpSubscription.class);
        when(userRegistry.getUser(INTERNAL_ID)).thenReturn(user);
        when(user.getSessions()).thenReturn(Set.of(session1, session2));
        when(session1.getId()).thenReturn("sess-a");
        when(session2.getId()).thenReturn("sess-b");
        when(session1.getSubscriptions()).thenReturn(Set.of(sub1));
        when(session2.getSubscriptions()).thenReturn(Set.of(sub2));
        when(sub1.getDestination()).thenReturn(ROOM_TOPIC);
        when(sub2.getDestination()).thenReturn(ROOM_TOPIC);
        when(sub1.getId()).thenReturn("sub-a");
        when(sub2.getId()).thenReturn("sub-b");

        assertThat(service.unsubscribeUserFromRoomTopic(ROOM_ID, INTERNAL_ID)).isEqualTo(2);

        verify(subscriptionRegistry, org.mockito.Mockito.times(2)).unregisterSubscription(any());
    }
}

package dev.burnedchats.security;

import dev.burnedchats.repository.RoomMembersRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.messaging.support.MessageHeaderAccessor;
import reactor.core.publisher.Mono;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("RoomTopicSubscribeInterceptor")
class RoomTopicSubscribeInterceptorTest {

    private static final String ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
    private static final String MEMBER_ID = "member-internal-id";

    @Mock
    private RoomMembersRepository roomMembersRepository;

    @Mock
    private MessageChannel clientOutboundChannel;

    @Mock
    private MessageChannel channel;

    private RoomTopicSubscribeInterceptor interceptor;

    @BeforeEach
    void setUp() {
        interceptor = new RoomTopicSubscribeInterceptor(roomMembersRepository, clientOutboundChannel);
    }

    @Test
    @DisplayName("allows SUBSCRIBE when user is a room member")
    void allowsMemberSubscribe() {
        AppPrincipal principal = mockPrincipal(MEMBER_ID);
        when(roomMembersRepository.isMember(ROOM_ID, MEMBER_ID)).thenReturn(Mono.just(true));

        Message<?> message = stompSubscribe("/topic/room/" + ROOM_ID, principal);
        Message<?> result = interceptor.preSend(message, channel);

        assertThat(result).isSameAs(message);
    }

    @Test
    @DisplayName("rejects SUBSCRIBE when user is not a room member")
    void rejectsNonMemberSubscribe() {
        AppPrincipal principal = mockPrincipal("outsider-id");
        when(roomMembersRepository.isMember(ROOM_ID, "outsider-id")).thenReturn(Mono.just(false));

        Message<?> message = stompSubscribe("/topic/room/" + ROOM_ID, principal);

        Message<?> result = interceptor.preSend(message, channel);

        assertThat(result).isNull();
        verify(clientOutboundChannel).send(argThat(RoomTopicSubscribeInterceptorTest::isNotMemberStompError));
    }

    @Test
    @DisplayName("rejects SUBSCRIBE for kicked member after membership cleanup")
    void rejectsKickedMemberSubscribe() {
        AppPrincipal principal = mockPrincipal(MEMBER_ID);
        when(roomMembersRepository.isMember(ROOM_ID, MEMBER_ID)).thenReturn(Mono.just(false));

        Message<?> message = stompSubscribe("/topic/room/" + ROOM_ID, principal);

        Message<?> result = interceptor.preSend(message, channel);

        assertThat(result).isNull();
        verify(clientOutboundChannel).send(argThat(RoomTopicSubscribeInterceptorTest::isNotMemberStompError));
    }

    @Test
    @DisplayName("passes through non-SUBSCRIBE commands")
    void passesNonSubscribe() {
        Message<?> message = stompMessage(
                StompCommand.SEND, "/topic/room/" + ROOM_ID, mock(AppPrincipal.class));

        Message<?> result = interceptor.preSend(message, channel);

        assertThat(result).isSameAs(message);
        verifyNoInteractions(roomMembersRepository);
    }

    @Test
    @DisplayName("passes through SUBSCRIBE to non-room destinations")
    void passesNonRoomDestination() {
        Message<?> message = stompSubscribe("/user/queue/notifications", mock(AppPrincipal.class));

        Message<?> result = interceptor.preSend(message, channel);

        assertThat(result).isSameAs(message);
        verifyNoInteractions(roomMembersRepository);
    }

    @Test
    @DisplayName("rejects SUBSCRIBE without authenticated principal")
    void rejectsWithoutPrincipal() {
        Message<?> message = stompSubscribe("/topic/room/" + ROOM_ID, null);

        Message<?> result = interceptor.preSend(message, channel);

        assertThat(result).isNull();
        verify(clientOutboundChannel).send(argThat(RoomTopicSubscribeInterceptorTest::isAuthErrorStompError));
        verifyNoInteractions(roomMembersRepository);
    }

    @Test
    @DisplayName("rejects malformed room topic destination")
    void rejectsMalformedDestination() {
        Message<?> message = stompSubscribe("/topic/room/", mock(AppPrincipal.class));

        Message<?> result = interceptor.preSend(message, channel);

        assertThat(result).isNull();
        verify(clientOutboundChannel).send(argThat(RoomTopicSubscribeInterceptorTest::isSubscribeDeniedStompError));
        verifyNoInteractions(roomMembersRepository);
    }

    private static boolean isAuthErrorStompError(Message<?> message) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        return accessor != null
                && accessor.getCommand() == StompCommand.ERROR
                && accessor.getMessage() != null
                && accessor.getMessage().contains("AUTH_ERROR");
    }

    private static boolean isNotMemberStompError(Message<?> message) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        return accessor != null
                && accessor.getCommand() == StompCommand.ERROR
                && accessor.getMessage() != null
                && accessor.getMessage().contains("NOT_MEMBER");
    }

    private static boolean isSubscribeDeniedStompError(Message<?> message) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        return accessor != null
                && accessor.getCommand() == StompCommand.ERROR
                && accessor.getMessage() != null
                && accessor.getMessage().contains("SUBSCRIBE_DENIED");
    }

    private static AppPrincipal mockPrincipal(String internalId) {
        AppPrincipal principal = mock(AppPrincipal.class);
        when(principal.getInternalId()).thenReturn(internalId);
        return principal;
    }

    private static Message<?> stompSubscribe(String destination, AppPrincipal principal) {
        return stompMessage(StompCommand.SUBSCRIBE, destination, principal);
    }

    private static Message<?> stompMessage(StompCommand command, String destination, AppPrincipal principal) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(command);
        accessor.setDestination(destination);
        accessor.setSessionId("test-session");
        if (principal != null) {
            accessor.setUser(principal);
        }
        accessor.setLeaveMutable(true);
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }
}

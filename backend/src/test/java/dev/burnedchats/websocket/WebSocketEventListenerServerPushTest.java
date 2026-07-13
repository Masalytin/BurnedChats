package dev.burnedchats.websocket;

import dev.burnedchats.config.MessagesProperties;
import dev.burnedchats.dto.event.SyncMessagesEvent;
import dev.burnedchats.dto.mapper.UserMapper;
import dev.burnedchats.model.Message;
import dev.burnedchats.repository.MessageRepository;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.RequestRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomPresenceRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.repository.UserRepository;
import dev.burnedchats.service.DeadmanService;
import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.lang.reflect.Method;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Regression: server-push on STOMP CONNECT must not drain the offline Redis queue
 * before the client subscribes to {@code /user/queue/sync-messages}.
 */
@ExtendWith(MockitoExtension.class)
class WebSocketEventListenerServerPushTest {

    private static final String SESSION_ID = "s-offline-1";
    private static final long USER_A = 1001L;

    @Mock
    private OnlineStatusRepository onlineStatusRepository;
    @Mock
    private DeadmanService deadmanService;
    @Mock
    private RoomMembersRepository roomMembersRepository;
    @Mock
    private RoomPresenceRepository roomPresenceRepository;
    @Mock
    private RequestRepository requestRepository;
    @Mock
    private UserRepository userRepository;
    @Mock
    private UserIdentityRepository userIdentityRepository;
    @Mock
    private MessageRepository messageRepository;
    @Mock
    private UserMapper userMapper;
    @Mock
    private SimpMessagingTemplate messagingTemplate;
    @Mock
    private MessagesProperties messagesProperties;

    @InjectMocks
    private WebSocketEventListener listener;

    private String internalA;

    @BeforeEach
    void setUp() {
        internalA = InternalIds.forTelegramId(USER_A);
    }

    @Test
    void serverPushSync_sendsEventButDoesNotDeleteOfflineQueue() throws Exception {
        Message offline = Message.builder()
                .messageId("m-offline-1")
                .sessionId(SESSION_ID)
                .senderId(USER_A)
                .encryptedContent("cipher")
                .iv("iv")
                .clientTimestamp(Instant.now().toEpochMilli())
                .build();

        when(messageRepository.getPendingMessages(internalA, SESSION_ID))
                .thenReturn(Flux.just(offline));
        when(messageRepository.getPendingEdits(internalA, SESSION_ID))
                .thenReturn(Flux.empty());
        when(messageRepository.getPendingDeletions(internalA, SESSION_ID))
                .thenReturn(Flux.empty());

        Method push = WebSocketEventListener.class.getDeclaredMethod(
                "pushPendingMessagesForSession", String.class, String.class);
        push.setAccessible(true);

        @SuppressWarnings("unchecked")
        Mono<Integer> result = (Mono<Integer>) push.invoke(listener, internalA, SESSION_ID);
        assertThat(result.block()).isEqualTo(1);

        ArgumentCaptor<SyncMessagesEvent> eventCap = ArgumentCaptor.forClass(SyncMessagesEvent.class);
        verify(messagingTemplate).convertAndSendToUser(
                eq(internalA),
                eq("/queue/sync-messages"),
                eventCap.capture());
        assertThat(eventCap.getValue().getSessionId()).isEqualTo(SESSION_ID);
        assertThat(eventCap.getValue().getMessages()).hasSize(1);

        verify(messageRepository, never()).deleteMessages(internalA, SESSION_ID);
        verify(messageRepository, never()).deleteEdits(internalA, SESSION_ID);
        verify(messageRepository, never()).deleteDeletions(internalA, SESSION_ID);
    }
}

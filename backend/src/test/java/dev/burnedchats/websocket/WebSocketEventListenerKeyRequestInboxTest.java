package dev.burnedchats.websocket;

import dev.burnedchats.config.MessagesProperties;
import dev.burnedchats.dto.mapper.UserMapper;
import dev.burnedchats.repository.MessageRepository;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.RequestRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomPresenceRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.repository.UserRepository;
import dev.burnedchats.security.AppPrincipal;
import dev.burnedchats.service.DeadmanService;
import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.web.socket.messaging.SessionConnectedEvent;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WebSocketEventListenerKeyRequestInboxTest {

    private static final String OWNER = InternalIds.forTelegramId(1L);

    @Mock private OnlineStatusRepository onlineStatusRepository;
    @Mock private DeadmanService deadmanService;
    @Mock private RoomMembersRepository roomMembersRepository;
    @Mock private RoomPresenceRepository roomPresenceRepository;
    @Mock private RequestRepository requestRepository;
    @Mock private UserRepository userRepository;
    @Mock private UserIdentityRepository userIdentityRepository;
    @Mock private MessageRepository messageRepository;
    @Mock private UserMapper userMapper;
    @Mock private SimpMessagingTemplate messagingTemplate;
    @Mock private MessagesProperties messagesProperties;
    @Mock private RoomKeyRequestInboxDelivery keyRequestInboxDelivery;

    @InjectMocks
    private WebSocketEventListener listener;

    @BeforeEach
    void stubConnectBasics() {
        MessagesProperties.ServerPushSync push = new MessagesProperties.ServerPushSync();
        push.setEnabled(false);
        when(messagesProperties.getServerPushSync()).thenReturn(push);
        when(onlineStatusRepository.setOnline(OWNER)).thenReturn(Mono.empty());
        when(deadmanService.syncStateOnConnect(OWNER)).thenReturn(Mono.empty());
        when(requestRepository.findByRecipient(OWNER)).thenReturn(Flux.empty());
        when(roomMembersRepository.getRoomsForMember(OWNER)).thenReturn(Flux.empty());
    }

    @Test
    void connect_drainsKeyRequestInbox() {
        listener.handleSessionConnected(connectedEvent());

        verify(keyRequestInboxDelivery, timeout(1000)).deliverOnConnect(OWNER);
    }

    private SessionConnectedEvent connectedEvent() {
        AppPrincipal principal = mock(AppPrincipal.class);
        when(principal.getInternalId()).thenReturn(OWNER);
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.CONNECTED);
        accessor.setUser(principal);
        accessor.setSessionId("ws-owner-1");
        accessor.setLeaveMutable(true);
        Message<byte[]> message = MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
        return new SessionConnectedEvent(this, message);
    }
}

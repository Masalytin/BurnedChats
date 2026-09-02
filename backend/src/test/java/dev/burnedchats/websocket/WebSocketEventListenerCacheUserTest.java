package dev.burnedchats.websocket;

import dev.burnedchats.config.MessagesProperties;
import dev.burnedchats.dto.mapper.UserMapper;
import dev.burnedchats.model.TelegramUser;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.MessageRepository;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.RequestRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomPresenceRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.repository.UserRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.security.TelegramInitData;
import dev.burnedchats.service.DeadmanService;
import dev.burnedchats.service.PresenceService;
import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import reactor.core.publisher.Mono;

import java.lang.reflect.Method;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WebSocketEventListenerCacheUserTest {

    private static final long TELEGRAM_ID = 4242L;
    private static final String PHOTO_URL = "https://t.me/i/userpic/320/test.svg";

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
    @Mock
    private PresenceService presenceService;

    @InjectMocks
    private WebSocketEventListener listener;

    @Test
    void cacheUserInfo_persistsPhotoUrlFromInitData() throws Exception {
        String internalId = InternalIds.forTelegramId(TELEGRAM_ID);
        TelegramInitData initData = TelegramInitData.builder()
                .authDate(Instant.now())
                .hash("test-hash")
                .user(TelegramUser.builder()
                        .id(TELEGRAM_ID)
                        .username("avatar-user")
                        .firstName("Avatar")
                        .lastName("User")
                        .photoUrl(PHOTO_URL)
                        .build())
                .build();
        UnifiedUser unifiedUser = new UnifiedUser(
                internalId,
                AuthType.TELEGRAM,
                "Avatar User",
                TELEGRAM_ID,
                null,
                PHOTO_URL);
        TelegramPrincipal principal = new TelegramPrincipal(unifiedUser, initData);

        when(userRepository.save(org.mockito.ArgumentMatchers.any(TelegramUser.class), eq(internalId)))
                .thenReturn(Mono.just(true));

        Method cacheUserInfo = WebSocketEventListener.class.getDeclaredMethod(
                "cacheUserInfo", TelegramPrincipal.class);
        cacheUserInfo.setAccessible(true);
        cacheUserInfo.invoke(listener, principal);

        ArgumentCaptor<TelegramUser> userCaptor = ArgumentCaptor.forClass(TelegramUser.class);
        verify(userRepository).save(userCaptor.capture(), eq(internalId));

        assertThat(userCaptor.getValue().getPhotoUrl()).isEqualTo(PHOTO_URL);
    }
}

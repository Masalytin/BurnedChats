package dev.burnedchats.messaging;

import dev.burnedchats.model.TelegramUser;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.security.AppPrincipal;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.security.StompAuthInterceptor.WalletPrincipal;
import dev.burnedchats.security.TelegramInitData;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.security.Principal;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
@DisplayName("StompUserMessenger")
class StompUserMessengerTest {

    private static final String INTERNAL_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    private static final Long TELEGRAM_ID = 42424242L;
    private static final String DEST = "/queue/test";
    private static final Object PAYLOAD = new Object();

    @Mock
    private SimpMessagingTemplate messagingTemplate;

    private StompUserMessenger messenger;

    @BeforeEach
    void setUp() {
        messenger = new StompUserMessenger(messagingTemplate);
    }

    @Test
    @DisplayName("convertAndSendToUser: TelegramPrincipal uses internalId, not telegram id")
    void telegramPrincipalRoutesByInternalId() {
        TelegramInitData init = TelegramInitData.builder()
                .authDate(Instant.now())
                .hash("h")
                .user(TelegramUser.builder().id(TELEGRAM_ID).username("u").build())
                .build();
        UnifiedUser user = new UnifiedUser(
                INTERNAL_ID,
                AuthType.TELEGRAM,
                "n",
                TELEGRAM_ID,
                null,
                null);
        AppPrincipal principal = new TelegramPrincipal(user, init);

        messenger.convertAndSendToUser(principal, DEST, PAYLOAD);

        verify(messagingTemplate).convertAndSendToUser(eq(INTERNAL_ID), eq(DEST), eq(PAYLOAD));
    }

    @Test
    @DisplayName("convertAndSendToUser: WalletPrincipal uses internalId")
    void walletPrincipalRoutesByInternalId() {
        UnifiedUser user = new UnifiedUser(
                INTERNAL_ID,
                AuthType.WALLET,
                "w",
                null,
                "EQtest",
                null);
        AppPrincipal principal = new WalletPrincipal(user);

        messenger.convertAndSendToUser(principal, DEST, PAYLOAD);

        verify(messagingTemplate).convertAndSendToUser(eq(INTERNAL_ID), eq(DEST), eq(PAYLOAD));
    }

    @Test
    @DisplayName("convertAndSendToUserPrincipal: delegates for AppPrincipal")
    void rawPrincipalOverloadAcceptsAppPrincipal() {
        UnifiedUser user = new UnifiedUser(
                INTERNAL_ID,
                AuthType.WALLET,
                "w",
                null,
                "EQx",
                null);
        Principal principal = new WalletPrincipal(user);

        messenger.convertAndSendToUserPrincipal(principal, DEST, PAYLOAD);

        verify(messagingTemplate).convertAndSendToUser(eq(INTERNAL_ID), eq(DEST), eq(PAYLOAD));
    }

    @Test
    @DisplayName("convertAndSendToUserPrincipal: rejects non-AppPrincipal")
    void rawPrincipalRejectsOther() {
        Principal other = () -> "anonymous";

        assertThatThrownBy(() -> messenger.convertAndSendToUserPrincipal(other, DEST, PAYLOAD))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("AppPrincipal");
    }

    @Test
    @DisplayName("convertAndSendToInternalId passes through")
    void internalIdOverload() {
        messenger.convertAndSendToInternalId(INTERNAL_ID, DEST, PAYLOAD);

        verify(messagingTemplate).convertAndSendToUser(eq(INTERNAL_ID), eq(DEST), eq(PAYLOAD));
    }
}

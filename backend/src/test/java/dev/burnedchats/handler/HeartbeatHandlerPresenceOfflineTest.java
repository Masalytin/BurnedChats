package dev.burnedchats.handler;

import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.security.StompAuthInterceptor.WalletPrincipal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * IMP-DMRD-01: {@code /app/presence.offline} marks the caller offline in Redis.
 */
@ExtendWith(MockitoExtension.class)
class HeartbeatHandlerPresenceOfflineTest {

    private static final String INTERNAL_ID = "wallet-uuid-aaa";

    @Mock
    private OnlineStatusRepository onlineStatusRepository;

    @InjectMocks
    private HeartbeatHandler heartbeatHandler;

    @Test
    @DisplayName("presence.offline sets Redis online key offline")
    void markOffline_appPrincipal_setsOffline() {
        when(onlineStatusRepository.setOffline(INTERNAL_ID)).thenReturn(Mono.just(1L));

        heartbeatHandler.markOffline(new WalletPrincipal(new UnifiedUser(
                INTERNAL_ID, AuthType.WALLET, "Wallet User", null, "0xabc", null)));

        verify(onlineStatusRepository).setOffline(INTERNAL_ID);
    }
}

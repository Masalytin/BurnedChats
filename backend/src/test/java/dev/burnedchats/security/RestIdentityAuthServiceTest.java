package dev.burnedchats.security;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.model.TelegramUser;
import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RestIdentityAuthServiceTest {

    private static final long TELEGRAM_ID = 4242L;
    private static final String INTERNAL_ID = InternalIds.forTelegramId(TELEGRAM_ID);
    private static final String WALLET_INTERNAL_ID = "wallet-internal-id-1234";
    private static final String WALLET_TOKEN = "opaque-wallet-token";

    @Mock
    private TelegramAuthService telegramAuthService;

    @Mock
    private SessionTokenService sessionTokenService;

    @InjectMocks
    private RestIdentityAuthService restIdentityAuthService;

    private void stubTelegramAuth() {
        TelegramUser user = TelegramUser.builder()
                .id(TELEGRAM_ID)
                .firstName("Test")
                .build();
        TelegramInitData init = TelegramInitData.builder()
                .user(user)
                .authDate(Instant.now())
                .hash("mock")
                .build();
        when(telegramAuthService.validateInitData(anyString())).thenReturn(init);
    }

    @Test
    void resolveTelegramDefaultsAuthTypeAndMapsInternalId() {
        stubTelegramAuth();
        StepVerifier.create(restIdentityAuthService.resolve(null, "init-data", null))
                .assertNext(identity -> {
                    assertThat(identity.internalId()).isEqualTo(INTERNAL_ID);
                    assertThat(identity.uploaderTgId()).isEqualTo(String.valueOf(TELEGRAM_ID));
                })
                .verifyComplete();
    }

    @Test
    void resolveTelegramExplicitAuthTypeWorks() {
        stubTelegramAuth();
        StepVerifier.create(restIdentityAuthService.resolve("telegram", "init-data", null))
                .assertNext(identity -> assertThat(identity.internalId()).isEqualTo(INTERNAL_ID))
                .verifyComplete();
    }

    @Test
    void resolveWalletMapsTokenToInternalId() {
        when(sessionTokenService.validateAndRefresh(WALLET_TOKEN)).thenReturn(Mono.just(WALLET_INTERNAL_ID));

        StepVerifier.create(restIdentityAuthService.resolve("wallet", null, WALLET_TOKEN))
                .assertNext(identity -> {
                    assertThat(identity.internalId()).isEqualTo(WALLET_INTERNAL_ID);
                    assertThat(identity.uploaderTgId()).isEqualTo(WALLET_INTERNAL_ID);
                })
                .verifyComplete();
    }

    @Test
    void missingTelegramInitDataReturns401() {
        StepVerifier.create(restIdentityAuthService.resolve("telegram", null, null))
                .expectError(AuthenticationException.class)
                .verify();
    }

    @Test
    void missingWalletTokenReturns401() {
        StepVerifier.create(restIdentityAuthService.resolve("wallet", null, null))
                .expectError(AuthenticationException.class)
                .verify();
    }

    @Test
    void invalidWalletTokenReturns401() {
        when(sessionTokenService.validateAndRefresh("bad-token")).thenReturn(Mono.empty());

        StepVerifier.create(restIdentityAuthService.resolve("wallet", null, "bad-token"))
                .expectError(AuthenticationException.class)
                .verify();
    }
}

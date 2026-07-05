package dev.burnedchats.security;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.model.TelegramUser;
import dev.burnedchats.repository.UserIdentityRepository;
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
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RestIdentityAuthServiceTest {

    private static final long TELEGRAM_ID = 4242L;
    private static final String LEGACY_INTERNAL_ID = InternalIds.forTelegramId(TELEGRAM_ID);
    private static final String LINKED_INTERNAL_ID = "aaaaaaaa-bbbb-cccc-dddd-linked-wallet";
    private static final String WALLET_INTERNAL_ID = "wallet-internal-id-1234";
    private static final String WALLET_TOKEN = "opaque-wallet-token";

    @Mock
    private TelegramAuthService telegramAuthService;

    @Mock
    private SessionTokenService sessionTokenService;

    @Mock
    private UserIdentityRepository userIdentityRepository;

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
    void resolveTelegramDefaultsAuthTypeAndMapsLegacyInternalIdWhenUnlinked() {
        stubTelegramAuth();
        when(userIdentityRepository.findByTelegramId(TELEGRAM_ID)).thenReturn(Mono.empty());

        StepVerifier.create(restIdentityAuthService.resolve(null, "init-data", null))
                .assertNext(identity -> {
                    assertThat(identity.internalId()).isEqualTo(LEGACY_INTERNAL_ID);
                    assertThat(identity.uploaderTgId()).isEqualTo(String.valueOf(TELEGRAM_ID));
                })
                .verifyComplete();
    }

    @Test
    void resolveTelegramUsesMappedInternalIdForLinkedAccount() {
        stubTelegramAuth();
        when(userIdentityRepository.findByTelegramId(TELEGRAM_ID))
                .thenReturn(Mono.just(LINKED_INTERNAL_ID));

        StepVerifier.create(restIdentityAuthService.resolve("telegram", "init-data", null))
                .assertNext(identity -> {
                    assertThat(identity.internalId()).isEqualTo(LINKED_INTERNAL_ID);
                    assertThat(identity.uploaderTgId()).isEqualTo(String.valueOf(TELEGRAM_ID));
                })
                .verifyComplete();
    }

    @Test
    void resolveTelegramExplicitAuthTypeWorks() {
        stubTelegramAuth();
        when(userIdentityRepository.findByTelegramId(anyLong())).thenReturn(Mono.empty());

        StepVerifier.create(restIdentityAuthService.resolve("telegram", "init-data", null))
                .assertNext(identity -> assertThat(identity.internalId()).isEqualTo(LEGACY_INTERNAL_ID))
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

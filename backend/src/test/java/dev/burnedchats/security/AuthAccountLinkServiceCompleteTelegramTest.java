package dev.burnedchats.security;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.repository.WalletTelegramLinkChallengeStore;
import dev.burnedchats.ton.TonProofVerifier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@DisplayName("AuthAccountLinkService.completeTelegramLink")
class AuthAccountLinkServiceCompleteTelegramTest {

    private static final String CHALLENGE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String INIT_DATA = "query_id=1";
    private static final String WALLET_ID = "wallet-user-1";
    private static final long TG_ID = 42L;

    private AuthenticationService authenticationService;
    private UserIdentityRepository userIdentityRepository;
    private WalletTelegramLinkChallengeStore challengeStore;
    private AuthAccountLinkService service;

    @BeforeEach
    void setUp() {
        authenticationService = mock(AuthenticationService.class);
        userIdentityRepository = mock(UserIdentityRepository.class);
        challengeStore = mock(WalletTelegramLinkChallengeStore.class);
        service = new AuthAccountLinkService(
                authenticationService,
                mock(TonProofVerifier.class),
                mock(SessionTokenService.class),
                userIdentityRepository,
                challengeStore);
    }

    @Test
    @DisplayName("conflict leaves the challenge key so the same startapp can retry")
    void conflictDoesNotConsumeChallenge() {
        when(challengeStore.peekInternalId(CHALLENGE)).thenReturn(Mono.just(WALLET_ID));
        when(authenticationService.authenticate(any(AuthCredentials.class)))
                .thenReturn(Mono.just(telegramUser()));
        when(userIdentityRepository.findById(WALLET_ID)).thenReturn(Mono.just(walletUser(null)));
        when(userIdentityRepository.linkTelegram(WALLET_ID, TG_ID))
                .thenReturn(Mono.error(new IllegalStateException("Telegram already linked to another account")));

        StepVerifier.create(service.completeTelegramLink(CHALLENGE, INIT_DATA))
                .expectError(IllegalStateException.class)
                .verify();

        verify(challengeStore, never()).consume(anyString());
        verify(challengeStore, never()).takeInternalId(anyString());
    }


    @Test
    @DisplayName("success deletes the challenge after linkTelegram")
    void successConsumesChallenge() {
        UnifiedUser linked = walletUser(TG_ID);
        when(challengeStore.peekInternalId(CHALLENGE)).thenReturn(Mono.just(WALLET_ID));
        when(authenticationService.authenticate(any(AuthCredentials.class)))
                .thenReturn(Mono.just(telegramUser()));
        when(userIdentityRepository.findById(WALLET_ID)).thenReturn(Mono.just(walletUser(null)), Mono.just(linked));
        when(userIdentityRepository.linkTelegram(WALLET_ID, TG_ID)).thenReturn(Mono.empty());
        when(challengeStore.consume(CHALLENGE)).thenReturn(Mono.empty());

        StepVerifier.create(service.completeTelegramLink(CHALLENGE, INIT_DATA))
                .expectNext(linked)
                .verifyComplete();

        verify(challengeStore).consume(CHALLENGE);
        verify(challengeStore, never()).takeInternalId(anyString());
    }

    @Test
    @DisplayName("missing challenge is expired without consume")
    void missingChallengeDoesNotConsume() {
        when(challengeStore.peekInternalId(CHALLENGE)).thenReturn(Mono.empty());

        StepVerifier.create(service.completeTelegramLink(CHALLENGE, INIT_DATA))
                .expectError(AuthenticationException.class)
                .verify();

        verify(challengeStore, never()).consume(anyString());
        verify(userIdentityRepository, never()).linkTelegram(anyString(), anyLong());
    }

    private static UnifiedUser telegramUser() {
        return new UnifiedUser("tg-derived", AuthType.TELEGRAM, "Alice", TG_ID, null, null);
    }

    private static UnifiedUser walletUser(Long telegramId) {
        return new UnifiedUser(WALLET_ID, AuthType.WALLET, "Wallet", telegramId, "0:aa", null);
    }
}

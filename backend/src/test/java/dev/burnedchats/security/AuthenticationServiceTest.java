package dev.burnedchats.security;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.model.TelegramUser;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Instant;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("AuthenticationService")
class AuthenticationServiceTest {

    private static final AuthCredentials SAMPLE = AuthCredentials.telegram("init-data");

    @Mock
    private AuthenticationStrategy telegramLike;

    @Mock
    private AuthenticationStrategy unmatched;

    private AuthenticationService authenticationService;

    @BeforeEach
    void setUp() {
        authenticationService = new AuthenticationService(List.of(unmatched, telegramLike));
    }

    @Test
    @DisplayName("delegates to first supporting strategy in list order")
    void delegatesFirstSupportingStrategy() {
        TelegramInitData init = TelegramInitData.builder()
                .hash("deadbeef")
                .authDate(Instant.now())
                .user(TelegramUser.builder().id(99L).firstName("T").username("tu").build())
                .build();
        UnifiedUser user = UnifiedUser.fromTelegram(init, InternalIds.forTelegramId(init.getUserId()));

        when(unmatched.supports(any())).thenReturn(false);
        when(telegramLike.supports(any())).thenReturn(true);
        when(telegramLike.authenticate(SAMPLE)).thenReturn(Mono.just(user));

        StepVerifier.create(authenticationService.authenticate(SAMPLE))
                .expectNext(user)
                .verifyComplete();

        verify(unmatched).supports(any());
        verify(telegramLike).supports(any());
        verify(telegramLike).authenticate(SAMPLE);
    }

    @Test
    @DisplayName("errors when nothing supports credentials")
    void errorsWhenNoStrategy() {
        when(unmatched.supports(any())).thenReturn(false);
        when(telegramLike.supports(any())).thenReturn(false);

        StepVerifier.create(authenticationService.authenticate(SAMPLE))
                .expectError(AuthenticationException.class)
                .verify();

        verify(telegramLike, never()).authenticate(any());
    }
}

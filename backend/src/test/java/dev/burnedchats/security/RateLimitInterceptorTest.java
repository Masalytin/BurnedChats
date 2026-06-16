package dev.burnedchats.security;

import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.service.RateLimitService;
import dev.burnedchats.service.RateLimitService.RateLimitType;
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
import reactor.core.publisher.Mono;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("RateLimitInterceptor")
class RateLimitInterceptorTest {

    @Mock
    private RateLimitService rateLimitService;

    @Mock
    private MessageChannel channel;

    private RateLimitInterceptor interceptor;

    @BeforeEach
    void setUp() {
        interceptor = new RateLimitInterceptor(rateLimitService);
    }

    @Test
    @DisplayName("passes through non-SEND STOMP commands")
    void passesNonSend() {
        Message<?> message = stompMessage(StompCommand.CONNECT, "/app/message.send", null);

        Message<?> result = interceptor.preSend(message, channel);

        assertThat(result).isSameAs(message);
        verifyNoInteractions(rateLimitService);
    }

    @Test
    @DisplayName("passes SEND when enforceRateLimit succeeds")
    void passesWhenAllowed() {
        AppPrincipal principal = mockPrincipal("user-123");
        when(rateLimitService.enforceRateLimit("user-123", RateLimitType.MESSAGE))
                .thenReturn(Mono.empty());

        Message<?> message = stompMessage(StompCommand.SEND, "/app/message.send", principal);
        Message<?> result = interceptor.preSend(message, channel);

        assertThat(result).isSameAs(message);
        verify(rateLimitService).enforceRateLimit("user-123", RateLimitType.MESSAGE);
    }

    @Test
    @DisplayName("throws RateLimitException when enforceRateLimit fails")
    void throwsWhenExceeded() {
        AppPrincipal principal = mockPrincipal("user-456");
        when(rateLimitService.enforceRateLimit("user-456", RateLimitType.MESSAGE))
                .thenReturn(Mono.error(new RateLimitException(Duration.ofSeconds(42))));

        Message<?> message = stompMessage(StompCommand.SEND, "/app/message.send", principal);

        assertThatThrownBy(() -> interceptor.preSend(message, channel))
                .isInstanceOf(RateLimitException.class)
                .satisfies(ex -> assertThat(((RateLimitException) ex).getRetryAfterSeconds()).isEqualTo(42L));
    }

    @Test
    @DisplayName("skips rate limit when principal is absent")
    void skipsWithoutPrincipal() {
        Message<?> message = stompMessage(StompCommand.SEND, "/app/message.send", null);

        Message<?> result = interceptor.preSend(message, channel);

        assertThat(result).isSameAs(message);
        verifyNoInteractions(rateLimitService);
    }

    @Test
    @DisplayName("maps unknown destinations to GENERAL rate limit")
    void generalForUnknownDestination() {
        AppPrincipal principal = mockPrincipal("user-789");
        when(rateLimitService.enforceRateLimit("user-789", RateLimitType.GENERAL))
                .thenReturn(Mono.empty());

        Message<?> message = stompMessage(StompCommand.SEND, "/app/unknown.route", principal);
        interceptor.preSend(message, channel);

        verify(rateLimitService).enforceRateLimit("user-789", RateLimitType.GENERAL);
    }

    private static AppPrincipal mockPrincipal(String internalId) {
        AppPrincipal principal = mock(AppPrincipal.class);
        when(principal.getInternalId()).thenReturn(internalId);
        return principal;
    }

    private static Message<?> stompMessage(StompCommand command, String destination, AppPrincipal principal) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(command);
        accessor.setDestination(destination);
        if (principal != null) {
            accessor.setUser(principal);
        }
        accessor.setLeaveMutable(true);
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }
}

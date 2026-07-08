package dev.burnedchats.security;

import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.handler.WebSocketExceptionHandler;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.service.RateLimitService;
import dev.burnedchats.service.RateLimitService.RateLimitType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("RateLimitInterceptor")
class RateLimitInterceptorTest {

    private static final String ERRORS_DESTINATION = "/queue/errors";

    @Mock
    private RateLimitService rateLimitService;

    @Mock
    private StompUserMessenger stompUserMessenger;

    @Mock
    private WebSocketExceptionHandler webSocketExceptionHandler;

    @Mock
    private MessageChannel channel;

    private RateLimitInterceptor interceptor;

    @BeforeEach
    void setUp() {
        interceptor = new RateLimitInterceptor(
                rateLimitService, stompUserMessenger, webSocketExceptionHandler);
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
    @DisplayName("drops SEND and publishes RATE_LIMIT_EXCEEDED when limit exceeded")
    void dropsFrameAndPublishesErrorWhenExceeded() {
        AppPrincipal principal = mockPrincipal("user-456");
        RateLimitException rateLimitException = new RateLimitException(Duration.ofSeconds(42));
        when(rateLimitService.enforceRateLimit("user-456", RateLimitType.MESSAGE))
                .thenReturn(Mono.error(rateLimitException));
        Map<String, Object> errorPayload = Map.of(
                "success", false,
                "error", "RATE_LIMIT_EXCEEDED",
                "retryAfter", 42L);
        when(webSocketExceptionHandler.handleRateLimitException(rateLimitException))
                .thenReturn(errorPayload);

        Message<?> message = stompMessage(StompCommand.SEND, "/app/message.send", principal);

        Message<?> result = interceptor.preSend(message, channel);

        assertThat(result).isNull();
        verify(webSocketExceptionHandler).handleRateLimitException(rateLimitException);
        verify(stompUserMessenger).convertAndSendToUser(principal, ERRORS_DESTINATION, errorPayload);
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

    @Test
    @DisplayName("heartbeat bypasses rate limiting even when GENERAL is exhausted")
    void heartbeatBypassesRateLimit() {
        AppPrincipal principal = mock(AppPrincipal.class);

        Message<?> message = stompMessage(StompCommand.SEND, "/app/heartbeat", principal);
        Message<?> result = interceptor.preSend(message, channel);

        assertThat(result).isSameAs(message);
        verifyNoInteractions(rateLimitService);
    }

    @Test
    @DisplayName("room read destinations use ROOM_READ bucket instead of GENERAL")
    void roomReadDestinationsUseDedicatedBucket() {
        AppPrincipal principal = mockPrincipal("user-room");
        when(rateLimitService.enforceRateLimit("user-room", RateLimitType.ROOM_READ))
                .thenReturn(Mono.empty());

        interceptor.preSend(stompMessage(StompCommand.SEND, "/app/room.getMembers", principal), channel);
        interceptor.preSend(stompMessage(StompCommand.SEND, "/app/room.getPresence", principal), channel);
        interceptor.preSend(stompMessage(StompCommand.SEND, "/app/room.getBans", principal), channel);

        ArgumentCaptor<RateLimitType> typeCaptor = ArgumentCaptor.forClass(RateLimitType.class);
        verify(rateLimitService, org.mockito.Mockito.times(3))
                .enforceRateLimit(eq("user-room"), typeCaptor.capture());
        assertThat(typeCaptor.getAllValues()).containsOnly(RateLimitType.ROOM_READ);
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

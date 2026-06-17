package dev.burnedchats.security.pow;

import dev.burnedchats.dto.event.SessionCreatedEvent;
import dev.burnedchats.dto.request.CreateSessionRequest;
import dev.burnedchats.integration.StompIntegrationTestBase;
import dev.burnedchats.integration.StompTestSupport;
import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.lang.NonNull;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.socket.messaging.WebSocketStompClient;

import java.lang.reflect.Type;
import java.time.Duration;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Backward-compat STOMP IT when {@code pow.enabled=false}.
 *
 * <p>Separate class (not {@code @Nested}) so Spring caches a dedicated context with PoW disabled.
 * {@code @Nested} + {@code @TestPropertySource} reused the parent context where PoW stayed enabled.
 */
@Tag("integration")
@TestPropertySource(properties = "pow.enabled=false")
class PowSessionGateWhenPowDisabledIntegrationTest extends StompIntegrationTestBase {

    private static final long RECIPIENT_TELEGRAM_ID = 2002L;

    @DynamicPropertySource
    static void powGateProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.database", () -> "15");
    }

    @Autowired
    private ReactiveRedisTemplate<String, String> redisTemplate;

    @BeforeEach
    void flushRedis() {
        var connection = redisTemplate.getConnectionFactory().getReactiveConnection();
        try {
            connection.serverCommands().flushDb().block(Duration.ofSeconds(5));
        } finally {
            connection.close();
        }
    }

    @Test
    @DisplayName("when pow.enabled=false → session.create without PoW succeeds (backward compat)")
    void sessionCreateWithoutPowSucceeds() throws Exception {
        String recipientInternalId = InternalIds.forTelegramId(RECIPIENT_TELEGRAM_ID);

        WebSocketStompClient stompClient = StompTestSupport.createStompClient();
        try {
            StompSession session = StompTestSupport.connect(stompClient, serverPort, "pow-disabled-init");

            BlockingQueue<SessionCreatedEvent> created = new LinkedBlockingQueue<>();
            session.subscribe("/user/queue/session-created", sessionCreatedHandler(created));
            StompTestSupport.awaitSubscriptionProcessed();

            CreateSessionRequest request = new CreateSessionRequest();
            request.setRecipientInternalId(recipientInternalId);
            session.send("/app/session.create", request);

            SessionCreatedEvent event = created.poll(5, TimeUnit.SECONDS);
            assertThat(event).isNotNull();
            assertThat(event.isSuccess()).isTrue();
        } finally {
            stompClient.stop();
        }
    }

    private static StompFrameHandler sessionCreatedHandler(BlockingQueue<SessionCreatedEvent> sink) {
        return new StompFrameHandler() {
            @Override
            public @NonNull Type getPayloadType(StompHeaders headers) {
                return SessionCreatedEvent.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                if (!sink.offer((SessionCreatedEvent) payload)) {
                    throw new IllegalStateException("unbounded queue must accept event");
                }
            }
        };
    }
}

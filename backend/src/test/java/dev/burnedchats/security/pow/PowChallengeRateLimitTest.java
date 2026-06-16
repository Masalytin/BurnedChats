package dev.burnedchats.security.pow;

import dev.burnedchats.dto.event.PowChallengeEvent;
import dev.burnedchats.integration.StompIntegrationTestBase;
import dev.burnedchats.integration.StompTestSupport;
import dev.burnedchats.service.RateLimitService.RateLimitType;
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
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * STOMP integration tests for per-identity rate limit on {@code /app/pow.challenge} (DESIGN.md §6.1).
 */
@Tag("integration")
@TestPropertySource(properties = "pow.enabled=true")
class PowChallengeRateLimitTest extends StompIntegrationTestBase {

    @DynamicPropertySource
    static void powChallengeRateLimitProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.database", () -> "14");
    }

    @Autowired
    private ReactiveRedisTemplate<String, String> redisTemplate;

    @BeforeEach
    void flushRedis() {
        redisTemplate.getConnectionFactory()
                .getReactiveConnection()
                .serverCommands()
                .flushDb()
                .block(Duration.ofSeconds(5));
    }

    @Test
    @DisplayName("pow.challenge flood → RATE_LIMIT_EXCEEDED on /user/queue/errors")
    void powChallengeFloodTriggersRateLimit() throws Exception {
        int limit = RateLimitType.POW_CHALLENGE.getMaxRequests();

        WebSocketStompClient stompClient = StompTestSupport.createStompClient();
        try {
            StompSession session = StompTestSupport.connect(stompClient, serverPort, "pow-challenge-rl");

            BlockingQueue<PowChallengeEvent> challenges = new LinkedBlockingQueue<>();
            BlockingQueue<Map<String, Object>> errors = new LinkedBlockingQueue<>();
            session.subscribe("/user/queue/pow-challenge", challengeHandler(challenges));
            session.subscribe("/user/queue/errors", errorHandler(errors));
            StompTestSupport.awaitSubscriptionProcessed();

            for (int i = 0; i < limit; i++) {
                session.send("/app/pow.challenge", Map.of("action", "session_create"));
                PowChallengeEvent event = challenges.poll(5, TimeUnit.SECONDS);
                assertThat(event).isNotNull();
                assertThat(event.getAction()).isEqualTo("session_create");
            }

            session.send("/app/pow.challenge", Map.of("action", "session_create"));

            Map<String, Object> rateLimitError = errors.poll(5, TimeUnit.SECONDS);
            assertThat(rateLimitError).isNotNull();
            assertThat(rateLimitError.get("error")).isEqualTo("RATE_LIMIT_EXCEEDED");
            assertThat(rateLimitError.get("retryAfter")).isNotNull();
        } finally {
            stompClient.stop();
        }
    }

    private static StompFrameHandler challengeHandler(BlockingQueue<PowChallengeEvent> sink) {
        return new StompFrameHandler() {
            @Override
            public @NonNull Type getPayloadType(StompHeaders headers) {
                return PowChallengeEvent.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                if (!sink.offer((PowChallengeEvent) payload)) {
                    throw new IllegalStateException("unbounded queue must accept challenge");
                }
            }
        };
    }

    @SuppressWarnings("unchecked")
    private static StompFrameHandler errorHandler(BlockingQueue<Map<String, Object>> sink) {
        return new StompFrameHandler() {
            @Override
            public @NonNull Type getPayloadType(StompHeaders headers) {
                return LinkedHashMap.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                if (!sink.offer((Map<String, Object>) payload)) {
                    throw new IllegalStateException("unbounded queue must accept error");
                }
            }
        };
    }
}

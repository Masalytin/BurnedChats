package dev.burnedchats.security.pow;

import dev.burnedchats.dto.event.PowChallengeEvent;
import dev.burnedchats.integration.StompIntegrationTestBase;
import dev.burnedchats.integration.StompTestSupport;
import dev.burnedchats.service.RateLimitService.RateLimitType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * STOMP integration tests for PoW issuance gating (IMP-POWFAST-07).
 *
 * <p>Gated actions still issue {@code pow:challenge:*}. Ungated wire actions
 * ({@code search}, {@code room_create}, {@code invite}) are refused with
 * {@code VALIDATION_ERROR} and must not write Redis. Unknown/blank stay silent.
 */
@Tag("integration")
@TestPropertySource(properties = "pow.enabled=true")
class PowHandlerIssuanceIntegrationTest extends StompIntegrationTestBase {

    @DynamicPropertySource
    static void powIssuanceProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.database", () -> "13");
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
    @DisplayName("session_create issue → pow-challenge event and Redis key")
    void sessionCreateIssuesChallenge() throws Exception {
        assertIssued("session_create");
    }

    @Test
    @DisplayName("dm_invite issue → pow-challenge event and Redis key")
    void dmInviteIssuesChallenge() throws Exception {
        assertIssued("dm_invite");
    }

    @ParameterizedTest
    @ValueSource(strings = {"search", "room_create", "invite"})
    @DisplayName("ungated action → VALIDATION_ERROR and no pow:challenge:*")
    void ungatedActionRefusedWithoutRedisKey(String action) throws Exception {
        WebSocketStompClient stompClient = StompTestSupport.createStompClient();
        try {
            StompSession session = StompTestSupport.connect(stompClient, serverPort, "pow-issuance-ungated");

            BlockingQueue<PowChallengeEvent> challenges = new LinkedBlockingQueue<>();
            BlockingQueue<Map<String, Object>> errors = new LinkedBlockingQueue<>();
            session.subscribe("/user/queue/pow-challenge", challengeHandler(challenges));
            session.subscribe("/user/queue/errors", errorHandler(errors));
            StompTestSupport.awaitSubscriptionProcessed();

            session.send("/app/pow.challenge", Map.of("action", action));

            Map<String, Object> error = errors.poll(5, TimeUnit.SECONDS);
            assertThat(error).isNotNull();
            assertThat(error.get("error")).isEqualTo("VALIDATION_ERROR");
            assertThat(challenges.poll(200, TimeUnit.MILLISECONDS)).isNull();
            assertThat(challengeKeys()).isEmpty();
        } finally {
            stompClient.stop();
        }
    }

    @Test
    @DisplayName("unknown action → silent (no error event, no Redis key)")
    void unknownActionRemainsSilent() throws Exception {
        assertSilent("not_a_real_action");
    }

    @Test
    @DisplayName("blank action → silent (no error event, no Redis key)")
    void blankActionRemainsSilent() throws Exception {
        assertSilent("   ");
    }

    @Test
    @DisplayName("11th ungated search → RATE_LIMIT_EXCEEDED after 10 refusals")
    void ungatedFloodHitsRateLimitAfterRefusals() throws Exception {
        int limit = RateLimitType.POW_CHALLENGE.getMaxRequests();

        WebSocketStompClient stompClient = StompTestSupport.createStompClient();
        try {
            StompSession session = StompTestSupport.connect(stompClient, serverPort, "pow-issuance-flood");

            BlockingQueue<PowChallengeEvent> challenges = new LinkedBlockingQueue<>();
            BlockingQueue<Map<String, Object>> errors = new LinkedBlockingQueue<>();
            session.subscribe("/user/queue/pow-challenge", challengeHandler(challenges));
            session.subscribe("/user/queue/errors", errorHandler(errors));
            StompTestSupport.awaitSubscriptionProcessed();

            for (int i = 0; i < limit; i++) {
                session.send("/app/pow.challenge", Map.of("action", "search"));
                Map<String, Object> refused = errors.poll(5, TimeUnit.SECONDS);
                assertThat(refused).isNotNull();
                assertThat(refused.get("error")).isEqualTo("VALIDATION_ERROR");
            }

            session.send("/app/pow.challenge", Map.of("action", "search"));

            Map<String, Object> rateLimitError = errors.poll(5, TimeUnit.SECONDS);
            assertThat(rateLimitError).isNotNull();
            assertThat(rateLimitError.get("error")).isEqualTo("RATE_LIMIT_EXCEEDED");
            assertThat(rateLimitError.get("retryAfter")).isNotNull();
            assertThat(challenges.poll(200, TimeUnit.MILLISECONDS)).isNull();
            assertThat(challengeKeys()).isEmpty();
        } finally {
            stompClient.stop();
        }
    }

    private void assertIssued(String action) throws Exception {
        WebSocketStompClient stompClient = StompTestSupport.createStompClient();
        try {
            StompSession session = StompTestSupport.connect(stompClient, serverPort, "pow-issuance-gated");

            BlockingQueue<PowChallengeEvent> challenges = new LinkedBlockingQueue<>();
            BlockingQueue<Map<String, Object>> errors = new LinkedBlockingQueue<>();
            session.subscribe("/user/queue/pow-challenge", challengeHandler(challenges));
            session.subscribe("/user/queue/errors", errorHandler(errors));
            StompTestSupport.awaitSubscriptionProcessed();

            session.send("/app/pow.challenge", Map.of("action", action));

            PowChallengeEvent event = challenges.poll(5, TimeUnit.SECONDS);
            assertThat(event).isNotNull();
            assertThat(event.getAction()).isEqualTo(action);
            assertThat(event.getChallengeId()).isNotBlank();
            assertThat(errors.poll(200, TimeUnit.MILLISECONDS)).isNull();
            assertThat(challengeKeys()).isNotEmpty();
        } finally {
            stompClient.stop();
        }
    }

    private void assertSilent(String action) throws Exception {
        WebSocketStompClient stompClient = StompTestSupport.createStompClient();
        try {
            StompSession session = StompTestSupport.connect(stompClient, serverPort, "pow-issuance-silent");

            BlockingQueue<PowChallengeEvent> challenges = new LinkedBlockingQueue<>();
            BlockingQueue<Map<String, Object>> errors = new LinkedBlockingQueue<>();
            session.subscribe("/user/queue/pow-challenge", challengeHandler(challenges));
            session.subscribe("/user/queue/errors", errorHandler(errors));
            StompTestSupport.awaitSubscriptionProcessed();

            session.send("/app/pow.challenge", Map.of("action", action));

            assertThat(errors.poll(1, TimeUnit.SECONDS)).isNull();
            assertThat(challenges.poll(200, TimeUnit.MILLISECONDS)).isNull();
            assertThat(challengeKeys()).isEmpty();
        } finally {
            stompClient.stop();
        }
    }

    private List<String> challengeKeys() {
        return redisTemplate.keys("pow:challenge:*")
                .collectList()
                .block(Duration.ofSeconds(5));
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

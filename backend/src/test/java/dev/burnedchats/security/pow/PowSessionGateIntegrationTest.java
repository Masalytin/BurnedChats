package dev.burnedchats.security.pow;

import dev.burnedchats.dto.event.SessionCreatedEvent;
import dev.burnedchats.dto.request.CreateSessionRequest;
import dev.burnedchats.dto.request.PowSolution;
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
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * STOMP integration tests for PoW gate on {@code /app/session.create} (DESIGN.md §6.2).
 */
@Tag("integration")
@TestPropertySource(properties = {
    "pow.enabled=true",
    "pow.base.session-create=12"
})
class PowSessionGateIntegrationTest extends StompIntegrationTestBase {

    private static final String NORMATIVE_CHALLENGE_ID = "00112233445566778899aabbccddeeff";
    private static final String NORMATIVE_NONCE = "1373";
    private static final int NORMATIVE_DIFFICULTY = 12;
    private static final long RECIPIENT_TELEGRAM_ID = 2002L;

    @DynamicPropertySource
    static void powGateProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.database", () -> "15");
    }

    @Autowired
    private ReactiveRedisTemplate<String, String> redisTemplate;

    @Autowired
    private dev.burnedchats.config.PowProperties powProperties;

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
    @DisplayName("session.create without PoW → POW_REQUIRED")
    void sessionCreateWithoutPowReturnsPowRequired() throws Exception {
        String recipientInternalId = InternalIds.forTelegramId(RECIPIENT_TELEGRAM_ID);

        WebSocketStompClient stompClient = StompTestSupport.createStompClient();
        try {
            StompSession session = StompTestSupport.connect(stompClient, serverPort, "pow-gate-init-data");

            BlockingQueue<Map<String, Object>> errors = new LinkedBlockingQueue<>();
            session.subscribe("/user/queue/errors", errorHandler(errors));
            StompTestSupport.awaitSubscriptionProcessed();

            CreateSessionRequest request = new CreateSessionRequest();
            request.setRecipientInternalId(recipientInternalId);
            session.send("/app/session.create", request);

            Map<String, Object> error = errors.poll(5, TimeUnit.SECONDS);
            assertThat(error).isNotNull();
            assertThat(error.get("error")).isEqualTo("POW_REQUIRED");
        } finally {
            stompClient.stop();
        }
    }

    @Test
    @DisplayName("session.create with valid PoW reaches business logic")
    void sessionCreateWithValidPowSucceeds() throws Exception {
        String recipientInternalId = InternalIds.forTelegramId(RECIPIENT_TELEGRAM_ID);
        seedChallenge(NORMATIVE_CHALLENGE_ID, PowAction.SESSION_CREATE, NORMATIVE_DIFFICULTY);

        WebSocketStompClient stompClient = StompTestSupport.createStompClient();
        try {
            StompSession session = StompTestSupport.connect(stompClient, serverPort, "pow-gate-valid");

            BlockingQueue<SessionCreatedEvent> created = new LinkedBlockingQueue<>();
            session.subscribe("/user/queue/session-created", sessionCreatedHandler(created));
            StompTestSupport.awaitSubscriptionProcessed();

            CreateSessionRequest request = buildSessionCreateRequest(recipientInternalId, NORMATIVE_CHALLENGE_ID);
            session.send("/app/session.create", request);

            SessionCreatedEvent event = created.poll(5, TimeUnit.SECONDS);
            assertThat(event).isNotNull();
            assertThat(event.isSuccess()).isTrue();
            assertThat(event.getSessionId()).isNotBlank();
        } finally {
            stompClient.stop();
        }
    }

    @Test
    @DisplayName("PoW and RateLimitService both apply on session.create")
    void powAndRateLimitBothApply() throws Exception {
        String recipientInternalId = InternalIds.forTelegramId(RECIPIENT_TELEGRAM_ID);
        int sessionCreateLimit = 3;

        WebSocketStompClient stompClient = StompTestSupport.createStompClient();
        try {
            StompSession session = StompTestSupport.connect(stompClient, serverPort, "pow-gate-ratelimit");

            BlockingQueue<SessionCreatedEvent> created = new LinkedBlockingQueue<>();
            BlockingQueue<Map<String, Object>> errors = new LinkedBlockingQueue<>();
            session.subscribe("/user/queue/session-created", sessionCreatedHandler(created));
            session.subscribe("/user/queue/errors", errorHandler(errors));
            StompTestSupport.awaitSubscriptionProcessed();

            // Gate layer (PoW + rate-limit) runs before business logic. Only one active session per
            // initiator is allowed, so attempts 2–3 pass the gate but fail with ALREADY_HAS_SESSION.
            for (int i = 0; i < sessionCreateLimit; i++) {
                String challengeId = String.format("%032x", i + 1);
                seedChallenge(challengeId, PowAction.SESSION_CREATE, NORMATIVE_DIFFICULTY);
                String nonce = findNonce(challengeId, NORMATIVE_DIFFICULTY);

                CreateSessionRequest request = new CreateSessionRequest();
                request.setRecipientInternalId(recipientInternalId);
                request.setPow(PowSolution.builder().challengeId(challengeId).nonce(nonce).build());
                session.send("/app/session.create", request);

                SessionCreatedEvent event = created.poll(5, TimeUnit.SECONDS);
                assertThat(event).isNotNull();
                if (i == 0) {
                    assertThat(event.isSuccess()).isTrue();
                    assertThat(event.getSessionId()).isNotBlank();
                } else {
                    assertThat(event.isSuccess()).isFalse();
                    assertThat(event.getError()).isEqualTo("ALREADY_HAS_SESSION");
                }
            }

            String overflowChallengeId = String.format("%032x", sessionCreateLimit + 1);
            seedChallenge(overflowChallengeId, PowAction.SESSION_CREATE, NORMATIVE_DIFFICULTY);
            String overflowNonce = findNonce(overflowChallengeId, NORMATIVE_DIFFICULTY);

            CreateSessionRequest overflowRequest = new CreateSessionRequest();
            overflowRequest.setRecipientInternalId(recipientInternalId);
            overflowRequest.setPow(PowSolution.builder()
                    .challengeId(overflowChallengeId)
                    .nonce(overflowNonce)
                    .build());
            session.send("/app/session.create", overflowRequest);

            Map<String, Object> rateLimitError = errors.poll(5, TimeUnit.SECONDS);
            assertThat(rateLimitError).isNotNull();
            assertThat(rateLimitError.get("error")).isEqualTo("RATE_LIMIT_EXCEEDED");
        } finally {
            stompClient.stop();
        }
    }

    private CreateSessionRequest buildSessionCreateRequest(String recipientInternalId, String challengeId) {
        CreateSessionRequest request = new CreateSessionRequest();
        request.setRecipientInternalId(recipientInternalId);
        request.setPow(PowSolution.builder()
                .challengeId(challengeId)
                .nonce(NORMATIVE_NONCE)
                .build());
        return request;
    }

    private void seedChallenge(String challengeId, PowAction action, int difficulty) {
        String key = PowChallengeService.challengeKey(challengeId);
        Map<String, String> fields = Map.of(
                "action", action.wireValue(),
                "difficulty", String.valueOf(difficulty),
                "issuedAt", String.valueOf(System.currentTimeMillis())
        );
        redisTemplate.opsForHash().putAll(key, fields).block(Duration.ofSeconds(5));
        redisTemplate.expire(key, powProperties.getChallengeTtl()).block(Duration.ofSeconds(5));
    }

    private static String findNonce(String challengeId, int difficulty) {
        for (long n = 0; n < 5_000_000; n++) {
            String nonce = Long.toString(n);
            if (PowHash.meetsDifficulty(challengeId, nonce, difficulty)) {
                return nonce;
            }
        }
        throw new IllegalStateException("no nonce found for difficulty " + difficulty);
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

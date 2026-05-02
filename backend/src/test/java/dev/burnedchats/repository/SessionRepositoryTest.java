package dev.burnedchats.repository;

import dev.burnedchats.config.SessionProperties;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.ReactiveHashOperations;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for SessionRepository.
 *
 * <p>Tests session storage operations with mocked Redis.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("SessionRepository")
class SessionRepositoryTest {

    @Mock
    private ReactiveRedisTemplate<String, String> redisTemplate;

    @Mock
    private ReactiveHashOperations<String, Object, Object> hashOperations;

    private SessionRepository sessionRepository;
    private final SessionProperties sessionProperties = new SessionProperties();

    private static final String TEST_SESSION_ID = "test-session-123";
    private static final Long INITIATOR_ID = 111111111L;
    private static final Long RESPONDER_ID = 222222222L;

    @BeforeEach
    void setUp() {
        when(redisTemplate.opsForHash()).thenReturn(hashOperations);
        sessionProperties.getActive().setTtl(3600);
        sessionRepository = new SessionRepository(redisTemplate, sessionProperties);
    }

    private Session createTestSession() {
        return Session.builder()
                .id(TEST_SESSION_ID)
                .initiatorInternalId(InternalIds.forTelegramId(INITIATOR_ID))
                .initiatorTelegramId(INITIATOR_ID)
                .responderInternalId(InternalIds.forTelegramId(RESPONDER_ID))
                .responderTelegramId(RESPONDER_ID)
                .status(SessionStatus.PENDING)
                .createdAt(Instant.now())
                .lastActivityAt(Instant.now())
                .build();
    }

    private Map<Object, Object> sessionToHashMap(Session session) {
        Map<Object, Object> map = new HashMap<>();
        map.put("id", session.getId());
        map.put("initiatorId", session.getInitiatorTelegramId().toString());
        map.put("responderId", session.getResponderTelegramId().toString());
        map.put("status", session.getStatus().name());
        map.put("createdAt", String.valueOf(session.getCreatedAt().toEpochMilli()));
        map.put("lastActivityAt", String.valueOf(session.getLastActivityAt().toEpochMilli()));
        map.put("initiatorVerified", String.valueOf(session.isInitiatorVerified()));
        map.put("responderVerified", String.valueOf(session.isResponderVerified()));
        return map;
    }

    @Nested
    @DisplayName("findById")
    class FindById {

        @Test
        @DisplayName("should return session when found")
        void shouldReturnSessionWhenFound() {
            // Given
            Session session = createTestSession();
            Map<Object, Object> hashMap = sessionToHashMap(session);
            String key = "session:" + TEST_SESSION_ID;

            when(hashOperations.entries(key)).thenReturn(Flux.fromIterable(hashMap.entrySet()));

            // When & Then
            StepVerifier.create(sessionRepository.findById(TEST_SESSION_ID))
                    .assertNext(found -> {
                        assertEquals(TEST_SESSION_ID, found.getId());
                        assertEquals(InternalIds.forTelegramId(INITIATOR_ID), found.getInitiatorInternalId());
                        assertEquals(InternalIds.forTelegramId(RESPONDER_ID), found.getResponderInternalId());
                        assertEquals(SessionStatus.PENDING, found.getStatus());
                    })
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return empty when session not found")
        void shouldReturnEmptyWhenNotFound() {
            // Given
            String key = "session:" + TEST_SESSION_ID;
            when(hashOperations.entries(key)).thenReturn(Flux.empty());

            // When & Then
            StepVerifier.create(sessionRepository.findById(TEST_SESSION_ID))
                    .verifyComplete();
        }

        @Test
        @DisplayName("should handle session with optional fields")
        void shouldHandleSessionWithOptionalFields() {
            // Given
            Map<Object, Object> hashMap = new HashMap<>();
            hashMap.put("id", TEST_SESSION_ID);
            hashMap.put("initiatorId", INITIATOR_ID.toString());
            hashMap.put("status", "ACTIVE");
            hashMap.put("createdAt", String.valueOf(Instant.now().toEpochMilli()));
            hashMap.put("lastActivityAt", String.valueOf(Instant.now().toEpochMilli()));
            hashMap.put("initiatorVerified", "true");
            hashMap.put("responderVerified", "false");
            hashMap.put("secretQuestion", "What is the secret?");
            hashMap.put("secretAnswerHash", "hash123");
            // Note: responderId is missing

            String key = "session:" + TEST_SESSION_ID;
            when(hashOperations.entries(key)).thenReturn(Flux.fromIterable(hashMap.entrySet()));

            // When & Then
            StepVerifier.create(sessionRepository.findById(TEST_SESSION_ID))
                    .assertNext(found -> {
                        assertEquals(TEST_SESSION_ID, found.getId());
                        assertEquals(InternalIds.forTelegramId(INITIATOR_ID), found.getInitiatorInternalId());
                        assertNull(found.getResponderInternalId());
                        assertTrue(found.isInitiatorVerified());
                        assertFalse(found.isResponderVerified());
                        assertEquals("What is the secret?", found.getSecretQuestion());
                        assertEquals("hash123", found.getSecretAnswerHash());
                    })
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("save")
    class Save {

        @Test
        @DisplayName("should save session to Redis")
        void shouldSaveSession() {
            // Given
            Session session = createTestSession();
            String key = "session:" + TEST_SESSION_ID;

            when(hashOperations.putAll(eq(key), anyMap())).thenReturn(Mono.just(true));
            when(redisTemplate.expire(eq(key), any(Duration.class))).thenReturn(Mono.just(true));

            // When & Then
            StepVerifier.create(sessionRepository.save(session))
                    .expectNext(true)
                    .verifyComplete();

            verify(hashOperations).putAll(eq(key), anyMap());
            verify(redisTemplate).expire(eq(key), eq(Duration.ofSeconds(3600)));
        }

        @Test
        @DisplayName("should save session with all fields")
        void shouldSaveSessionWithAllFields() {
            // Given
            Session session = createTestSession();
            session.setSecretQuestion("What is the password?");
            session.setSecretAnswerHash("hash123");
            session.setInitiatorVerified(true);
            session.setHandshakeCompletedAt(Instant.now());
            String key = "session:" + TEST_SESSION_ID;

            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, String>> mapCaptor = ArgumentCaptor.forClass(Map.class);
            when(hashOperations.putAll(eq(key), mapCaptor.capture())).thenReturn(Mono.just(true));
            when(redisTemplate.expire(eq(key), any(Duration.class))).thenReturn(Mono.just(true));

            // When
            sessionRepository.save(session).block();

            // Then
            Map<String, String> savedMap = mapCaptor.getValue();
            assertEquals(TEST_SESSION_ID, savedMap.get("id"));
            assertEquals(INITIATOR_ID.toString(), savedMap.get("initiatorId"));
            assertEquals(RESPONDER_ID.toString(), savedMap.get("responderId"));
            assertEquals("PENDING", savedMap.get("status"));
            assertEquals("What is the password?", savedMap.get("secretQuestion"));
            assertEquals("hash123", savedMap.get("secretAnswerHash"));
            assertEquals("true", savedMap.get("initiatorVerified"));
            assertNotNull(savedMap.get("handshakeCompletedAt"));
        }
    }

    @Nested
    @DisplayName("updateStatus")
    class UpdateStatus {

        @Test
        @DisplayName("should update session status")
        void shouldUpdateStatus() {
            // Given
            String key = "session:" + TEST_SESSION_ID;
            when(hashOperations.put(eq(key), eq("status"), eq("ACTIVE"))).thenReturn(Mono.just(true));
            when(hashOperations.put(eq(key), eq("lastActivityAt"), anyString())).thenReturn(Mono.just(true));

            // When & Then
            StepVerifier.create(sessionRepository.updateStatus(TEST_SESSION_ID, SessionStatus.ACTIVE))
                    .expectNext(true)
                    .verifyComplete();

            verify(hashOperations).put(key, "status", "ACTIVE");
        }
    }

    @Nested
    @DisplayName("updateVerification")
    class UpdateVerification {

        @Test
        @DisplayName("should update initiator verification")
        void shouldUpdateInitiatorVerification() {
            // Given
            Session session = createTestSession();
            Map<Object, Object> hashMap = sessionToHashMap(session);
            String key = "session:" + TEST_SESSION_ID;

            when(hashOperations.entries(key)).thenReturn(Flux.fromIterable(hashMap.entrySet()));
            when(hashOperations.put(eq(key), eq("initiatorVerified"), eq("true"))).thenReturn(Mono.just(true));

            // When & Then
            StepVerifier.create(sessionRepository.updateVerification(TEST_SESSION_ID, INITIATOR_ID, true))
                    .expectNext(true)
                    .verifyComplete();

            verify(hashOperations).put(key, "initiatorVerified", "true");
        }

        @Test
        @DisplayName("should update responder verification")
        void shouldUpdateResponderVerification() {
            // Given
            Session session = createTestSession();
            Map<Object, Object> hashMap = sessionToHashMap(session);
            String key = "session:" + TEST_SESSION_ID;

            when(hashOperations.entries(key)).thenReturn(Flux.fromIterable(hashMap.entrySet()));
            when(hashOperations.put(eq(key), eq("responderVerified"), eq("true"))).thenReturn(Mono.just(true));

            // When & Then
            StepVerifier.create(sessionRepository.updateVerification(TEST_SESSION_ID, RESPONDER_ID, true))
                    .expectNext(true)
                    .verifyComplete();

            verify(hashOperations).put(key, "responderVerified", "true");
        }

        @Test
        @DisplayName("should return false when session not found")
        void shouldReturnFalseWhenSessionNotFound() {
            // Given
            String key = "session:" + TEST_SESSION_ID;
            when(hashOperations.entries(key)).thenReturn(Flux.empty());

            // When & Then
            StepVerifier.create(sessionRepository.updateVerification(TEST_SESSION_ID, INITIATOR_ID, true))
                    .expectNext(false)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("setHandshakeCompleted")
    class SetHandshakeCompleted {

        @Test
        @DisplayName("should set handshake completed timestamp and status")
        void shouldSetHandshakeCompleted() {
            // Given
            String key = "session:" + TEST_SESSION_ID;
            when(hashOperations.put(eq(key), eq("handshakeCompletedAt"), anyString())).thenReturn(Mono.just(true));
            when(hashOperations.put(eq(key), eq("status"), eq("ACTIVE"))).thenReturn(Mono.just(true));
            when(hashOperations.put(eq(key), eq("lastActivityAt"), anyString())).thenReturn(Mono.just(true));

            // When & Then
            StepVerifier.create(sessionRepository.setHandshakeCompleted(TEST_SESSION_ID))
                    .expectNext(true)
                    .verifyComplete();

            verify(hashOperations).put(eq(key), eq("handshakeCompletedAt"), anyString());
            verify(hashOperations).put(key, "status", "ACTIVE");
        }
    }

    @Nested
    @DisplayName("delete")
    class Delete {

        @Test
        @DisplayName("should delete session")
        void shouldDeleteSession() {
            // Given
            String key = "session:" + TEST_SESSION_ID;
            when(redisTemplate.delete(key)).thenReturn(Mono.just(1L));

            // When & Then
            StepVerifier.create(sessionRepository.delete(TEST_SESSION_ID))
                    .expectNext(1L)
                    .verifyComplete();

            verify(redisTemplate).delete(key);
        }

        @Test
        @DisplayName("should return 0 when session not found")
        void shouldReturnZeroWhenNotFound() {
            // Given
            String key = "session:" + TEST_SESSION_ID;
            when(redisTemplate.delete(key)).thenReturn(Mono.just(0L));

            // When & Then
            StepVerifier.create(sessionRepository.delete(TEST_SESSION_ID))
                    .expectNext(0L)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("exists")
    class Exists {

        @Test
        @DisplayName("should return true when session exists")
        void shouldReturnTrueWhenExists() {
            // Given
            String key = "session:" + TEST_SESSION_ID;
            when(redisTemplate.hasKey(key)).thenReturn(Mono.just(true));

            // When & Then
            StepVerifier.create(sessionRepository.exists(TEST_SESSION_ID))
                    .expectNext(true)
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return false when session does not exist")
        void shouldReturnFalseWhenNotExists() {
            // Given
            String key = "session:" + TEST_SESSION_ID;
            when(redisTemplate.hasKey(key)).thenReturn(Mono.just(false));

            // When & Then
            StepVerifier.create(sessionRepository.exists(TEST_SESSION_ID))
                    .expectNext(false)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("refreshTtl")
    class RefreshTtl {

        @Test
        @DisplayName("should refresh session TTL")
        void shouldRefreshTtl() {
            // Given
            String key = "session:" + TEST_SESSION_ID;
            when(redisTemplate.expire(key, Duration.ofSeconds(3600))).thenReturn(Mono.just(true));

            // When & Then
            StepVerifier.create(sessionRepository.refreshTtl(TEST_SESSION_ID))
                    .expectNext(true)
                    .verifyComplete();

            verify(redisTemplate).expire(key, Duration.ofSeconds(3600));
        }
    }

    @Nested
    @DisplayName("updateLastActivity")
    class UpdateLastActivity {

        @Test
        @DisplayName("should update last activity timestamp")
        void shouldUpdateLastActivity() {
            // Given
            String key = "session:" + TEST_SESSION_ID;
            when(hashOperations.put(eq(key), eq("lastActivityAt"), anyString())).thenReturn(Mono.just(true));

            // When & Then
            StepVerifier.create(sessionRepository.updateLastActivity(TEST_SESSION_ID))
                    .expectNext(true)
                    .verifyComplete();

            verify(hashOperations).put(eq(key), eq("lastActivityAt"), anyString());
        }
    }
}

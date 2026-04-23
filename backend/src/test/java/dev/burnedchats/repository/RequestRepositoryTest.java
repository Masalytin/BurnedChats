package dev.burnedchats.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import dev.burnedchats.model.ChatRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.ReactiveListOperations;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Duration;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for RequestRepository.
 *
 * <p>Tests chat request storage operations with mocked Redis.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("RequestRepository")
class RequestRepositoryTest {

    @Mock
    private ReactiveRedisTemplate<String, String> redisTemplate;

    @Mock
    private ReactiveListOperations<String, String> listOperations;

    private RequestRepository requestRepository;
    private ObjectMapper objectMapper;

    private static final String TEST_SESSION_ID = "session-123";
    private static final Long SENDER_ID = 111111111L;
    private static final Long RECIPIENT_ID = 222222222L;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.disable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        // Ignore unknown properties (like "expired" from isExpired() getter)
        objectMapper.configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        when(redisTemplate.opsForList()).thenReturn(listOperations);
        requestRepository = new RequestRepository(redisTemplate, objectMapper);
    }

    /**
     * Creates a test request with a recent createdAt time that won't be filtered as expired.
     * Uses a time 30 seconds ago to ensure the request is valid (expiration is 5 minutes).
     */
    private ChatRequest createTestRequest() {
        return ChatRequest.builder()
                .sessionId(TEST_SESSION_ID)
                .senderTgId(SENDER_ID)
                .senderUsername("alice")
                .senderFirstName("Alice")
                .senderLastName("Smith")
                .recipientTgId(RECIPIENT_ID)
                .hasQuestion(false)
                .createdAt(Instant.now().minusSeconds(30)) // 30 seconds ago, well within 5-minute TTL
                .build();
    }

    private String toJson(ChatRequest request) {
        try {
            return objectMapper.writeValueAsString(request);
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }

    @Nested
    @DisplayName("save")
    class Save {

        @Test
        @DisplayName("should save request to Redis list")
        void shouldSaveRequest() {
            // Given
            ChatRequest request = createTestRequest();
            String key = "request:" + RECIPIENT_ID;

            when(listOperations.leftPush(eq(key), anyString())).thenReturn(Mono.just(1L));
            when(redisTemplate.expire(eq(key), any(Duration.class))).thenReturn(Mono.just(true));

            // When & Then
            StepVerifier.create(requestRepository.save(request))
                    .expectNext(1L)
                    .verifyComplete();

            verify(listOperations).leftPush(eq(key), anyString());
            verify(redisTemplate).expire(eq(key), eq(Duration.ofMinutes(5)));
        }

        @Test
        @DisplayName("should save request with secret question")
        void shouldSaveRequestWithQuestion() {
            // Given
            ChatRequest request = createTestRequest();
            request.setHasQuestion(true);
            request.setQuestion("What is the secret code?");
            String key = "request:" + RECIPIENT_ID;

            when(listOperations.leftPush(eq(key), anyString())).thenReturn(Mono.just(1L));
            when(redisTemplate.expire(eq(key), any(Duration.class))).thenReturn(Mono.just(true));

            // When & Then
            StepVerifier.create(requestRepository.save(request))
                    .expectNext(1L)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("findByRecipient")
    class FindByRecipient {

        @Test
        @DisplayName("should return requests for recipient")
        void shouldReturnRequestsForRecipient() {
            // Given
            ChatRequest request = createTestRequest();
            String key = "request:" + RECIPIENT_ID;
            String json = toJson(request);

            when(listOperations.range(key, 0, -1)).thenReturn(Flux.just(json));

            // When & Then
            StepVerifier.create(requestRepository.findByRecipient(RECIPIENT_ID))
                    .assertNext(found -> {
                        assertEquals(TEST_SESSION_ID, found.getSessionId());
                        assertEquals(SENDER_ID, found.getSenderTgId());
                        assertEquals("alice", found.getSenderUsername());
                    })
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return empty when no requests")
        void shouldReturnEmptyWhenNoRequests() {
            // Given
            String key = "request:" + RECIPIENT_ID;
            when(listOperations.range(key, 0, -1)).thenReturn(Flux.empty());

            // When & Then
            StepVerifier.create(requestRepository.findByRecipient(RECIPIENT_ID))
                    .verifyComplete();
        }

        @Test
        @DisplayName("should filter expired requests")
        void shouldFilterExpiredRequests() {
            // Given
            ChatRequest expiredRequest = createTestRequest();
            expiredRequest.setCreatedAt(Instant.now().minusSeconds(600)); // 10 minutes ago

            ChatRequest validRequest = createTestRequest();
            validRequest.setSessionId("session-456");

            String key = "request:" + RECIPIENT_ID;
            when(listOperations.range(key, 0, -1))
                    .thenReturn(Flux.just(toJson(expiredRequest), toJson(validRequest)));

            // When & Then
            StepVerifier.create(requestRepository.findByRecipient(RECIPIENT_ID))
                    .assertNext(found -> assertEquals("session-456", found.getSessionId()))
                    .verifyComplete();
        }

        @Test
        @DisplayName("should skip invalid JSON gracefully")
        void shouldSkipInvalidJson() {
            // Given
            ChatRequest validRequest = createTestRequest();
            String key = "request:" + RECIPIENT_ID;

            when(listOperations.range(key, 0, -1))
                    .thenReturn(Flux.just("invalid-json", toJson(validRequest)));

            // When & Then
            StepVerifier.create(requestRepository.findByRecipient(RECIPIENT_ID))
                    .assertNext(found -> assertEquals(TEST_SESSION_ID, found.getSessionId()))
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("findBySessionId")
    class FindBySessionId {

        @Test
        @DisplayName("should find request by session ID for recipient")
        void shouldFindBySessionIdForRecipient() {
            // Given
            ChatRequest request1 = createTestRequest();
            ChatRequest request2 = createTestRequest();
            request2.setSessionId("other-session");

            String key = "request:" + RECIPIENT_ID;
            when(listOperations.range(key, 0, -1))
                    .thenReturn(Flux.just(toJson(request1), toJson(request2)));

            // When & Then
            StepVerifier.create(requestRepository.findBySessionId(RECIPIENT_ID, TEST_SESSION_ID))
                    .assertNext(found -> {
                        assertEquals(TEST_SESSION_ID, found.getSessionId());
                        assertEquals(SENDER_ID, found.getSenderTgId());
                    })
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return empty when session not found")
        void shouldReturnEmptyWhenSessionNotFound() {
            // Given
            ChatRequest request = createTestRequest();
            String key = "request:" + RECIPIENT_ID;
            when(listOperations.range(key, 0, -1)).thenReturn(Flux.just(toJson(request)));

            // When & Then
            StepVerifier.create(requestRepository.findBySessionId(RECIPIENT_ID, "non-existent"))
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("delete")
    class Delete {

        @Test
        @DisplayName("should delete request from list")
        void shouldDeleteRequest() {
            // Given
            ChatRequest request = createTestRequest();
            String key = "request:" + RECIPIENT_ID;

            when(listOperations.range(key, 0, -1)).thenReturn(Flux.just(toJson(request)));
            when(listOperations.remove(eq(key), eq(1L), anyString())).thenReturn(Mono.just(1L));

            // When & Then
            StepVerifier.create(requestRepository.delete(RECIPIENT_ID, TEST_SESSION_ID))
                    .expectNext(true)
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return false when request not found")
        void shouldReturnFalseWhenNotFound() {
            // Given
            String key = "request:" + RECIPIENT_ID;
            when(listOperations.range(key, 0, -1)).thenReturn(Flux.empty());

            // When & Then
            StepVerifier.create(requestRepository.delete(RECIPIENT_ID, TEST_SESSION_ID))
                    .expectNext(false)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("deleteAll")
    class DeleteAll {

        @Test
        @DisplayName("should delete all requests for recipient")
        void shouldDeleteAllRequests() {
            // Given
            String key = "request:" + RECIPIENT_ID;
            when(redisTemplate.delete(key)).thenReturn(Mono.just(1L));

            // When & Then
            StepVerifier.create(requestRepository.deleteAll(RECIPIENT_ID))
                    .expectNext(1L)
                    .verifyComplete();

            verify(redisTemplate).delete(key);
        }
    }

    @Nested
    @DisplayName("countByRecipient")
    class CountByRecipient {

        @Test
        @DisplayName("should return request count")
        void shouldReturnCount() {
            // Given
            String key = "request:" + RECIPIENT_ID;
            when(listOperations.size(key)).thenReturn(Mono.just(5L));

            // When & Then
            StepVerifier.create(requestRepository.countByRecipient(RECIPIENT_ID))
                    .expectNext(5L)
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return zero when no requests")
        void shouldReturnZeroWhenNoRequests() {
            // Given
            String key = "request:" + RECIPIENT_ID;
            when(listOperations.size(key)).thenReturn(Mono.just(0L));

            // When & Then
            StepVerifier.create(requestRepository.countByRecipient(RECIPIENT_ID))
                    .expectNext(0L)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("existsBetween")
    class ExistsBetween {

        @Test
        @DisplayName("should return true when request exists between users")
        void shouldReturnTrueWhenExists() {
            // Given
            ChatRequest request = createTestRequest();
            String key = "request:" + RECIPIENT_ID;
            when(listOperations.range(key, 0, -1)).thenReturn(Flux.just(toJson(request)));

            // When & Then
            StepVerifier.create(requestRepository.existsBetween(SENDER_ID, RECIPIENT_ID))
                    .expectNext(true)
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return false when no request between users")
        void shouldReturnFalseWhenNotExists() {
            // Given
            ChatRequest request = createTestRequest();
            request.setSenderTgId(999999999L); // Different sender
            String key = "request:" + RECIPIENT_ID;
            when(listOperations.range(key, 0, -1)).thenReturn(Flux.just(toJson(request)));

            // When & Then
            StepVerifier.create(requestRepository.existsBetween(SENDER_ID, RECIPIENT_ID))
                    .expectNext(false)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("refreshTtl")
    class RefreshTtl {

        @Test
        @DisplayName("should refresh TTL")
        void shouldRefreshTtl() {
            // Given
            String key = "request:" + RECIPIENT_ID;
            when(redisTemplate.expire(key, Duration.ofMinutes(5))).thenReturn(Mono.just(true));

            // When & Then
            StepVerifier.create(requestRepository.refreshTtl(RECIPIENT_ID))
                    .expectNext(true)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("ChatRequest model")
    class ChatRequestModel {

        @Test
        @DisplayName("isExpired should return true for old request")
        void isExpiredShouldReturnTrueForOldRequest() {
            // Given
            ChatRequest request = createTestRequest();
            request.setCreatedAt(Instant.now().minusSeconds(600)); // 10 minutes ago

            // When & Then
            assertTrue(request.isExpired());
        }

        @Test
        @DisplayName("isExpired should return false for recent request")
        void isExpiredShouldReturnFalseForRecentRequest() {
            // Given
            ChatRequest request = createTestRequest();
            request.setCreatedAt(Instant.now().minusSeconds(60)); // 1 minute ago

            // When & Then
            assertFalse(request.isExpired());
        }

        @Test
        @DisplayName("getExpiresAt should return correct time")
        void getExpiresAtShouldReturnCorrectTime() {
            // Given
            Instant now = Instant.now();
            ChatRequest request = createTestRequest();
            request.setCreatedAt(now);

            // When
            Instant expiresAt = request.getExpiresAt();

            // Then
            assertEquals(now.plusSeconds(5 * 60), expiresAt);
        }
    }
}

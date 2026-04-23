package dev.burnedchats.service;

import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.service.RateLimitService.RateLimitType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.ReactiveValueOperations;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for RateLimitService.
 *
 * <p>Tests rate limiting functionality with mocked Redis operations.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("RateLimitService")
class RateLimitServiceTest {

    @Mock
    private ReactiveRedisTemplate<String, String> redisTemplate;

    @Mock
    private ReactiveValueOperations<String, String> valueOperations;

    private RateLimitService rateLimitService;

    private static final Long TEST_USER_ID = 123456789L;

    @BeforeEach
    void setUp() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        rateLimitService = new RateLimitService(redisTemplate);
    }

    @Nested
    @DisplayName("checkRateLimit")
    class CheckRateLimit {

        @Test
        @DisplayName("should allow first request")
        void shouldAllowFirstRequest() {
            // Given
            String expectedKey = "ratelimit:search:" + TEST_USER_ID;
            when(valueOperations.increment(expectedKey)).thenReturn(Mono.just(1L));
            when(redisTemplate.expire(eq(expectedKey), any(Duration.class))).thenReturn(Mono.just(true));

            // When & Then
            StepVerifier.create(rateLimitService.checkRateLimit(TEST_USER_ID, RateLimitType.SEARCH))
                    .expectNext(true)
                    .verifyComplete();

            verify(valueOperations).increment(expectedKey);
            verify(redisTemplate).expire(eq(expectedKey), eq(Duration.ofMinutes(1)));
        }

        @Test
        @DisplayName("should allow requests within limit")
        void shouldAllowRequestsWithinLimit() {
            // Given - 5th request (limit is 10 for SEARCH)
            String expectedKey = "ratelimit:search:" + TEST_USER_ID;
            when(valueOperations.increment(expectedKey)).thenReturn(Mono.just(5L));

            // When & Then
            StepVerifier.create(rateLimitService.checkRateLimit(TEST_USER_ID, RateLimitType.SEARCH))
                    .expectNext(true)
                    .verifyComplete();

            verify(valueOperations).increment(expectedKey);
            verify(redisTemplate, never()).expire(anyString(), any(Duration.class));
        }

        @Test
        @DisplayName("should reject request when limit exceeded")
        void shouldRejectWhenLimitExceeded() {
            // Given - 11th request (limit is 10 for SEARCH)
            String expectedKey = "ratelimit:search:" + TEST_USER_ID;
            when(valueOperations.increment(expectedKey)).thenReturn(Mono.just(11L));
            when(redisTemplate.getExpire(expectedKey)).thenReturn(Mono.just(Duration.ofSeconds(30)));

            // When & Then
            StepVerifier.create(rateLimitService.checkRateLimit(TEST_USER_ID, RateLimitType.SEARCH))
                    .expectErrorSatisfies(error -> {
                        assertInstanceOf(RateLimitException.class, error);
                        RateLimitException rle = (RateLimitException) error;
                        assertEquals(30, rle.getRetryAfter().getSeconds());
                    })
                    .verify();
        }

        @Test
        @DisplayName("should use default TTL when expire returns empty")
        void shouldUseDefaultTtlWhenExpireReturnsEmpty() {
            // Given
            String expectedKey = "ratelimit:search:" + TEST_USER_ID;
            when(valueOperations.increment(expectedKey)).thenReturn(Mono.just(11L));
            when(redisTemplate.getExpire(expectedKey)).thenReturn(Mono.empty());

            // When & Then
            StepVerifier.create(rateLimitService.checkRateLimit(TEST_USER_ID, RateLimitType.SEARCH))
                    .expectErrorSatisfies(error -> {
                        assertInstanceOf(RateLimitException.class, error);
                        RateLimitException rle = (RateLimitException) error;
                        // Default TTL for SEARCH is 1 minute
                        assertEquals(60, rle.getRetryAfter().getSeconds());
                    })
                    .verify();
        }

        @Test
        @DisplayName("should apply different limits for different types")
        void shouldApplyDifferentLimitsForDifferentTypes() {
            // Given - SESSION_CREATE has limit of 3
            String expectedKey = "ratelimit:session_create:" + TEST_USER_ID;
            when(valueOperations.increment(expectedKey)).thenReturn(Mono.just(4L));
            when(redisTemplate.getExpire(expectedKey)).thenReturn(Mono.just(Duration.ofSeconds(45)));

            // When & Then
            StepVerifier.create(rateLimitService.checkRateLimit(TEST_USER_ID, RateLimitType.SESSION_CREATE))
                    .expectError(RateLimitException.class)
                    .verify();
        }

        @Test
        @DisplayName("should allow MESSAGE type with higher limit")
        void shouldAllowMessageTypeWithHigherLimit() {
            // Given - MESSAGE has limit of 60
            String expectedKey = "ratelimit:message:" + TEST_USER_ID;
            when(valueOperations.increment(expectedKey)).thenReturn(Mono.just(50L));

            // When & Then
            StepVerifier.create(rateLimitService.checkRateLimit(TEST_USER_ID, RateLimitType.MESSAGE))
                    .expectNext(true)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("checkRateLimitBlocking")
    class CheckRateLimitBlocking {

        @Test
        @DisplayName("should not throw when within limit")
        void shouldNotThrowWhenWithinLimit() {
            // Given
            String expectedKey = "ratelimit:general:" + TEST_USER_ID;
            when(valueOperations.increment(expectedKey)).thenReturn(Mono.just(1L));
            when(redisTemplate.expire(eq(expectedKey), any(Duration.class))).thenReturn(Mono.just(true));

            // When & Then
            assertDoesNotThrow(() -> 
                    rateLimitService.checkRateLimitBlocking(TEST_USER_ID, RateLimitType.GENERAL));
        }

        @Test
        @DisplayName("should throw when limit exceeded")
        void shouldThrowWhenLimitExceeded() {
            // Given
            String expectedKey = "ratelimit:general:" + TEST_USER_ID;
            when(valueOperations.increment(expectedKey)).thenReturn(Mono.just(101L));
            when(redisTemplate.getExpire(expectedKey)).thenReturn(Mono.just(Duration.ofSeconds(30)));

            // When & Then
            assertThrows(RateLimitException.class, () ->
                    rateLimitService.checkRateLimitBlocking(TEST_USER_ID, RateLimitType.GENERAL));
        }
    }

    @Nested
    @DisplayName("getRemainingRequests")
    class GetRemainingRequests {

        @Test
        @DisplayName("should return full limit for new user")
        void shouldReturnFullLimitForNewUser() {
            // Given
            String expectedKey = "ratelimit:search:" + TEST_USER_ID;
            when(valueOperations.get(expectedKey)).thenReturn(Mono.empty());

            // When & Then
            StepVerifier.create(rateLimitService.getRemainingRequests(TEST_USER_ID, RateLimitType.SEARCH))
                    .expectNext(10) // SEARCH limit is 10
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return remaining requests")
        void shouldReturnRemainingRequests() {
            // Given
            String expectedKey = "ratelimit:search:" + TEST_USER_ID;
            when(valueOperations.get(expectedKey)).thenReturn(Mono.just("7"));

            // When & Then
            StepVerifier.create(rateLimitService.getRemainingRequests(TEST_USER_ID, RateLimitType.SEARCH))
                    .expectNext(3) // 10 - 7 = 3
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return zero when limit exhausted")
        void shouldReturnZeroWhenLimitExhausted() {
            // Given
            String expectedKey = "ratelimit:search:" + TEST_USER_ID;
            when(valueOperations.get(expectedKey)).thenReturn(Mono.just("15"));

            // When & Then
            StepVerifier.create(rateLimitService.getRemainingRequests(TEST_USER_ID, RateLimitType.SEARCH))
                    .expectNext(0) // max(0, 10 - 15) = 0
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("resetRateLimit")
    class ResetRateLimit {

        @Test
        @DisplayName("should return true when key deleted")
        void shouldReturnTrueWhenKeyDeleted() {
            // Given
            String expectedKey = "ratelimit:search:" + TEST_USER_ID;
            when(redisTemplate.delete(expectedKey)).thenReturn(Mono.just(1L));

            // When & Then
            StepVerifier.create(rateLimitService.resetRateLimit(TEST_USER_ID, RateLimitType.SEARCH))
                    .expectNext(true)
                    .verifyComplete();

            verify(redisTemplate).delete(expectedKey);
        }

        @Test
        @DisplayName("should return false when key not found")
        void shouldReturnFalseWhenKeyNotFound() {
            // Given
            String expectedKey = "ratelimit:search:" + TEST_USER_ID;
            when(redisTemplate.delete(expectedKey)).thenReturn(Mono.just(0L));

            // When & Then
            StepVerifier.create(rateLimitService.resetRateLimit(TEST_USER_ID, RateLimitType.SEARCH))
                    .expectNext(false)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("RateLimitType")
    class RateLimitTypeTest {

        @Test
        @DisplayName("should have correct configuration for SEARCH")
        void shouldHaveCorrectConfigForSearch() {
            assertEquals(10, RateLimitType.SEARCH.getMaxRequests());
            assertEquals(Duration.ofMinutes(1), RateLimitType.SEARCH.getWindow());
        }

        @Test
        @DisplayName("should have correct configuration for SESSION_CREATE")
        void shouldHaveCorrectConfigForSessionCreate() {
            assertEquals(3, RateLimitType.SESSION_CREATE.getMaxRequests());
            assertEquals(Duration.ofMinutes(1), RateLimitType.SESSION_CREATE.getWindow());
        }

        @Test
        @DisplayName("should have correct configuration for MESSAGE")
        void shouldHaveCorrectConfigForMessage() {
            assertEquals(60, RateLimitType.MESSAGE.getMaxRequests());
            assertEquals(Duration.ofMinutes(1), RateLimitType.MESSAGE.getWindow());
        }

        @Test
        @DisplayName("should have correct configuration for GENERAL")
        void shouldHaveCorrectConfigForGeneral() {
            assertEquals(100, RateLimitType.GENERAL.getMaxRequests());
            assertEquals(Duration.ofMinutes(1), RateLimitType.GENERAL.getWindow());
        }

        @Test
        @DisplayName("should have correct configuration for SESSION_ACTION")
        void shouldHaveCorrectConfigForSessionAction() {
            assertEquals(10, RateLimitType.SESSION_ACTION.getMaxRequests());
            assertEquals(Duration.ofMinutes(1), RateLimitType.SESSION_ACTION.getWindow());
        }

        @Test
        @DisplayName("should have correct configuration for HANDSHAKE")
        void shouldHaveCorrectConfigForHandshake() {
            assertEquals(10, RateLimitType.HANDSHAKE.getMaxRequests());
            assertEquals(Duration.ofMinutes(1), RateLimitType.HANDSHAKE.getWindow());
        }
    }
}

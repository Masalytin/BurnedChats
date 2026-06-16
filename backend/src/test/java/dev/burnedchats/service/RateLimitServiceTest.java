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
import org.springframework.data.redis.core.script.RedisScript;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
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

    /**
     * Stub the atomic INCR+EXPIRE Lua script so it yields the given post-increment counter value.
     */
    @SuppressWarnings("unchecked")
    private void stubScriptCount(long count) {
        when(redisTemplate.execute(any(RedisScript.class), anyList(), anyList()))
                .thenReturn(Flux.just(count));
    }

    @Nested
    @DisplayName("checkRateLimit")
    class CheckRateLimit {

        @Test
        @DisplayName("should allow first request")
        void shouldAllowFirstRequest() {
            // Given - atomic script returns count == 1 (TTL set inside the script)
            stubScriptCount(1L);

            // When & Then
            StepVerifier.create(rateLimitService.checkRateLimit(TEST_USER_ID, RateLimitType.SEARCH))
                    .expectNext(true)
                    .verifyComplete();

            verify(redisTemplate).execute(any(RedisScript.class), anyList(), anyList());
        }

        @Test
        @DisplayName("should allow requests within limit")
        void shouldAllowRequestsWithinLimit() {
            // Given - 5th request (limit is 10 for SEARCH)
            stubScriptCount(5L);

            // When & Then
            StepVerifier.create(rateLimitService.checkRateLimit(TEST_USER_ID, RateLimitType.SEARCH))
                    .expectNext(true)
                    .verifyComplete();

            verify(redisTemplate).execute(any(RedisScript.class), anyList(), anyList());
        }

        @Test
        @DisplayName("should reject request when limit exceeded")
        void shouldRejectWhenLimitExceeded() {
            // Given - 11th request (limit is 10 for SEARCH)
            String expectedKey = "ratelimit:search:" + TEST_USER_ID;
            stubScriptCount(11L);
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
            stubScriptCount(11L);
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
            stubScriptCount(4L);
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
            stubScriptCount(50L);

            // When & Then
            StepVerifier.create(rateLimitService.checkRateLimit(TEST_USER_ID, RateLimitType.MESSAGE))
                    .expectNext(true)
                    .verifyComplete();
        }

        @Test
        @DisplayName("concurrent first requests set TTL exactly once and enforce the window cap")
        void concurrentFirstRequestsSetTtlOnceAndEnforceCap() throws InterruptedException {
            // Given - a single atomic counter shared by all concurrent calls, mirroring the
            // server-side INCR+EXPIRE Lua semantics: only the call that observes count == 1
            // performs EXPIRE, and it does so atomically with the increment.
            String expectedKey = "ratelimit:search:" + TEST_USER_ID;
            int limit = RateLimitType.SEARCH.getMaxRequests();
            int concurrency = limit * 5;

            AtomicLong redisCounter = new AtomicLong();
            AtomicInteger expireInvocations = new AtomicInteger();

            when(redisTemplate.execute(any(RedisScript.class), anyList(), anyList()))
                    .thenAnswer(invocation -> {
                        long count = redisCounter.incrementAndGet();
                        if (count == 1) {
                            // Modelled as part of the same atomic evaluation as the INCR.
                            expireInvocations.incrementAndGet();
                        }
                        return Flux.just(count);
                    });
            when(redisTemplate.getExpire(expectedKey)).thenReturn(Mono.just(Duration.ofSeconds(60)));

            AtomicInteger allowed = new AtomicInteger();
            AtomicInteger rejected = new AtomicInteger();
            CountDownLatch start = new CountDownLatch(1);
            CountDownLatch done = new CountDownLatch(concurrency);
            ExecutorService pool = Executors.newFixedThreadPool(Math.min(concurrency, 16));

            try {
                for (int i = 0; i < concurrency; i++) {
                    pool.submit(() -> {
                        try {
                            start.await();
                            Boolean ok = rateLimitService
                                    .checkRateLimit(TEST_USER_ID, RateLimitType.SEARCH)
                                    .block();
                            if (Boolean.TRUE.equals(ok)) {
                                allowed.incrementAndGet();
                            }
                        } catch (RateLimitException e) {
                            rejected.incrementAndGet();
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                        } finally {
                            done.countDown();
                        }
                    });
                }
                start.countDown();
                assertTrue(done.await(10, TimeUnit.SECONDS), "all concurrent requests must finish");
            } finally {
                pool.shutdownNow();
            }

            // TTL is established exactly once → the window is never reset by a racing first request.
            assertEquals(1, expireInvocations.get(), "EXPIRE must run exactly once across the race");
            assertEquals(concurrency, redisCounter.get(), "every request must increment the counter");
            // No window bypass: exactly `limit` requests pass, the rest are rejected.
            assertEquals(limit, allowed.get(), "only up to the limit may be allowed");
            assertEquals(concurrency - limit, rejected.get(), "all over-limit requests must be rejected");
        }
    }

    @Nested
    @DisplayName("checkRateLimitBlocking")
    class CheckRateLimitBlocking {

        @Test
        @DisplayName("should not throw when within limit")
        void shouldNotThrowWhenWithinLimit() {
            // Given
            stubScriptCount(1L);

            // When & Then
            assertDoesNotThrow(() -> 
                    rateLimitService.checkRateLimitBlocking(TEST_USER_ID, RateLimitType.GENERAL));
        }

        @Test
        @DisplayName("should throw when limit exceeded")
        void shouldThrowWhenLimitExceeded() {
            // Given
            String expectedKey = "ratelimit:general:" + TEST_USER_ID;
            stubScriptCount(101L);
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

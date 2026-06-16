package dev.burnedchats.service;

import dev.burnedchats.config.FileStorageProperties;
import dev.burnedchats.exception.RateLimitException;
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

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link FileValidationService} concurrent download slot management.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("FileValidationService")
class FileValidationServiceTest {

    private static final String INTERNAL_ID = "tg:123456789";
    private static final String SLOT_KEY = "filedownload:active:" + INTERNAL_ID;
    private static final Duration SLOT_TTL = Duration.ofMinutes(30);

    @Mock
    private FileStorageProperties fileStorageProperties;

    @Mock
    private RateLimitService rateLimitService;

    @Mock
    private ReactiveRedisTemplate<String, String> redisTemplate;

    @Mock
    private ReactiveValueOperations<String, String> valueOperations;

    private FileValidationService fileValidationService;

    @BeforeEach
    void setUp() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(fileStorageProperties.getMaxConcurrentDownloadsPerUser()).thenReturn(3);
        when(fileStorageProperties.getConcurrentDownloadSlotTtl()).thenReturn(SLOT_TTL);
        fileValidationService = new FileValidationService(
                fileStorageProperties, rateLimitService, redisTemplate);
    }

    @Nested
    @DisplayName("acquireDownloadSlot")
    class AcquireDownloadSlot {

        @Test
        @DisplayName("should acquire slot when under limit")
        void shouldAcquireWhenUnderLimit() {
            when(valueOperations.increment(SLOT_KEY)).thenReturn(Mono.just(2L));
            when(redisTemplate.expire(eq(SLOT_KEY), eq(SLOT_TTL))).thenReturn(Mono.just(true));

            StepVerifier.create(fileValidationService.acquireDownloadSlot(INTERNAL_ID))
                    .verifyComplete();

            verify(valueOperations).increment(SLOT_KEY);
            verify(redisTemplate).expire(SLOT_KEY, SLOT_TTL);
            verify(valueOperations, never()).decrement(any());
        }

        @Test
        @DisplayName("should reject when limit exceeded")
        void shouldRejectWhenLimitExceeded() {
            when(valueOperations.increment(SLOT_KEY)).thenReturn(Mono.just(4L));
            when(redisTemplate.expire(eq(SLOT_KEY), eq(SLOT_TTL))).thenReturn(Mono.just(true));
            when(valueOperations.decrement(SLOT_KEY)).thenReturn(Mono.just(3L));
            when(valueOperations.get(SLOT_KEY)).thenReturn(Mono.just("3"));

            StepVerifier.create(fileValidationService.acquireDownloadSlot(INTERNAL_ID))
                    .expectErrorSatisfies(error -> {
                        assert error instanceof RateLimitException;
                        RateLimitException rateLimit = (RateLimitException) error;
                        assert rateLimit.getErrorCode().equals("RATE_LIMIT_EXCEEDED");
                        assert rateLimit.getRetryAfterSeconds() == 5;
                    })
                    .verify();

            verify(valueOperations).decrement(SLOT_KEY);
        }

        @Test
        @DisplayName("should skip Redis when limit disabled")
        void shouldSkipWhenLimitDisabled() {
            when(fileStorageProperties.getMaxConcurrentDownloadsPerUser()).thenReturn(0);

            StepVerifier.create(fileValidationService.acquireDownloadSlot(INTERNAL_ID))
                    .verifyComplete();

            verify(valueOperations, never()).increment(any());
        }
    }

    @Nested
    @DisplayName("releaseDownloadSlot")
    class ReleaseDownloadSlot {

        @Test
        @DisplayName("should decrement active counter")
        void shouldDecrementCounter() {
            when(valueOperations.decrement(SLOT_KEY)).thenReturn(Mono.just(1L));

            StepVerifier.create(fileValidationService.releaseDownloadSlot(INTERNAL_ID))
                    .verifyComplete();

            verify(valueOperations).decrement(SLOT_KEY);
            verify(redisTemplate, never()).delete(eq(SLOT_KEY));
        }

        @Test
        @DisplayName("should delete key when counter reaches zero")
        void shouldDeleteKeyWhenZero() {
            when(valueOperations.decrement(SLOT_KEY)).thenReturn(Mono.just(0L));
            when(redisTemplate.delete(SLOT_KEY)).thenReturn(Mono.just(1L));

            StepVerifier.create(fileValidationService.releaseDownloadSlot(INTERNAL_ID))
                    .verifyComplete();

            verify(redisTemplate).delete(SLOT_KEY);
        }

        @Test
        @DisplayName("should skip Redis when limit disabled")
        void shouldSkipWhenLimitDisabled() {
            when(fileStorageProperties.getMaxConcurrentDownloadsPerUser()).thenReturn(0);

            StepVerifier.create(fileValidationService.releaseDownloadSlot(INTERNAL_ID))
                    .verifyComplete();

            verify(valueOperations, never()).decrement(any());
        }
    }
}

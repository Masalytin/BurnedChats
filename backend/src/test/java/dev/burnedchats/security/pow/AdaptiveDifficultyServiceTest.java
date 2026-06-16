package dev.burnedchats.security.pow;

import dev.burnedchats.config.PowProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.redis.core.ReactiveHashOperations;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("AdaptiveDifficultyService")
class AdaptiveDifficultyServiceTest {

    @Mock
    private ReactiveRedisTemplate<String, String> redisTemplate;

    @Mock
    private ReactiveHashOperations<String, Object, Object> hashOperations;

    @Mock
    private ObjectProvider<AdaptiveDifficultyService.ReputationDifficultyResolver> reputationResolver;

    private PowProperties properties;
    private AdaptiveDifficultyService service;

    @BeforeEach
    void setUp() {
        properties = new PowProperties();
        properties.setEnabled(true);
        properties.setCeiling(26);
        properties.setAbuseWindow(Duration.ofSeconds(60));
        properties.getBase().setSessionCreate(20);

        when(redisTemplate.opsForHash()).thenReturn(hashOperations);
        when(reputationResolver.getIfAvailable()).thenReturn(null);

        service = new AdaptiveDifficultyService(redisTemplate, properties, reputationResolver);
    }

    @Nested
    @DisplayName("bump table (DESIGN.md §5.2)")
    class BumpTable {

        @Test
        void normalSignalNoBump() {
            assertThat(AdaptiveDifficultyService.bumpForSignal(0.0)).isZero();
            assertThat(AdaptiveDifficultyService.bumpForSignal(0.09)).isZero();
        }

        @Test
        void elevatedActivity() {
            assertThat(AdaptiveDifficultyService.bumpForSignal(0.10)).isEqualTo(2);
            assertThat(AdaptiveDifficultyService.bumpForSignal(0.24)).isEqualTo(2);
        }

        @Test
        void probableAttack() {
            assertThat(AdaptiveDifficultyService.bumpForSignal(0.25)).isEqualTo(4);
            assertThat(AdaptiveDifficultyService.bumpForSignal(0.49)).isEqualTo(4);
        }

        @Test
        void activeAttack() {
            assertThat(AdaptiveDifficultyService.bumpForSignal(0.50)).isEqualTo(6);
            assertThat(AdaptiveDifficultyService.bumpForSignal(1.0)).isEqualTo(6);
        }

        @Test
        void cappedAtCeiling() {
            assertThat(AdaptiveDifficultyService.resolveDifficulty(20, 0.99, 26)).isEqualTo(26);
        }
    }

    @Nested
    @DisplayName("currentDifficulty")
    class CurrentDifficulty {

        @BeforeEach
        void stubCounters() {
            when(hashOperations.multiGet(eq(AdaptiveDifficultyService.ABUSE_GLOBAL_KEY),
                    eq(List.of("rejected", "total"))))
                    .thenReturn(Mono.just(List.of("0", "10")));
        }

        @Test
        void returnsBaseWhenNoAbuse() {
            StepVerifier.create(service.currentDifficulty(PowAction.SESSION_CREATE))
                    .expectNext(20)
                    .verifyComplete();
        }

        @Test
        void appliesBumpFromAbuseRatio() {
            when(hashOperations.multiGet(eq(AdaptiveDifficultyService.ABUSE_GLOBAL_KEY),
                    eq(List.of("rejected", "total"))))
                    .thenReturn(Mono.just(List.of("2", "10")));

            StepVerifier.create(service.currentDifficulty(PowAction.SESSION_CREATE))
                    .expectNext(22)
                    .verifyComplete();
        }

        @Test
        void disabledReturnsZero() {
            properties.setEnabled(false);

            StepVerifier.create(service.currentDifficulty(PowAction.SESSION_CREATE))
                    .expectNext(0)
                    .verifyComplete();

            verify(hashOperations, never()).multiGet(anyString(), any());
        }
    }

    @Nested
    @DisplayName("abuse counters")
    class AbuseCounters {

        @BeforeEach
        void stubIncrement() {
            when(hashOperations.increment(anyString(), anyString(), anyLong()))
                    .thenReturn(Mono.just(1L));
            when(redisTemplate.expire(anyString(), any(Duration.class)))
                    .thenReturn(Mono.just(true));
        }

        @Test
        void recordGatedAttemptIncrementsTotalWithTtl() {
            StepVerifier.create(service.recordGatedAttempt())
                    .verifyComplete();

            verify(hashOperations).increment(AdaptiveDifficultyService.ABUSE_GLOBAL_KEY, "total", 1L);
            verify(redisTemplate).expire(AdaptiveDifficultyService.ABUSE_GLOBAL_KEY,
                    properties.getAbuseWindow());
        }

        @Test
        void recordRejectedIncrementsRejectedWithTtl() {
            StepVerifier.create(service.recordRejected())
                    .verifyComplete();

            verify(hashOperations).increment(AdaptiveDifficultyService.ABUSE_GLOBAL_KEY, "rejected", 1L);
            verify(redisTemplate).expire(AdaptiveDifficultyService.ABUSE_GLOBAL_KEY,
                    properties.getAbuseWindow());
        }
    }
}

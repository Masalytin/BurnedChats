package dev.burnedchats.security.pow;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import reactor.test.StepVerifier;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for {@link AdaptiveDifficultyService} on real Redis (Testcontainers).
 */
@SpringBootTest
@ActiveProfiles("test")
@Testcontainers(disabledWithoutDocker = true)
@Tag("integration")
@DisplayName("AdaptiveDifficultyService (Redis integration)")
class AdaptiveDifficultyServiceTest {

    @Container
    @SuppressWarnings("resource")
    private static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7-alpine"))
                    .withExposedPorts(6379);

    @DynamicPropertySource
    static void registerRedis(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379).toString());
        registry.add("spring.data.redis.database", () -> "14");
        registry.add("pow.enabled", () -> "true");
        registry.add("pow.ceiling", () -> "26");
        registry.add("pow.base.session-create", () -> "20");
        registry.add("pow.abuse-window", () -> "PT2S");
    }

    @Autowired
    private AdaptiveDifficultyService service;

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
    @DisplayName("currentDifficulty on Redis")
    class CurrentDifficulty {

        @Test
        void returnsBaseWhenNoAbuse() {
            StepVerifier.create(service.currentDifficulty(PowAction.SESSION_CREATE))
                    .expectNext(20)
                    .verifyComplete();
        }

        @Test
        void appliesSteppedBumpFromAbuseRatio() {
            recordAttempts(8);
            recordRejections(2);

            StepVerifier.create(service.currentDifficulty(PowAction.SESSION_CREATE))
                    .expectNext(22)
                    .verifyComplete();
        }

        @Test
        void respectsCeilingAtActiveAttack() {
            recordAttempts(5);
            recordRejections(5);

            StepVerifier.create(service.currentDifficulty(PowAction.SESSION_CREATE))
                    .expectNext(26)
                    .verifyComplete();
        }

        @Test
        void disabledReturnsZeroWithoutRedisReads() {
            AdaptiveDifficultyService disabled = new AdaptiveDifficultyService(
                    redisTemplate,
                    disabledProperties(),
                    nullReputationProvider());

            StepVerifier.create(disabled.currentDifficulty(PowAction.SESSION_CREATE))
                    .expectNext(0)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("abuse counters")
    class AbuseCounters {

        @Test
        void recordGatedAttemptIncrementsTotalWithTtl() {
            StepVerifier.create(service.recordGatedAttempt())
                    .verifyComplete();

            StepVerifier.create(redisTemplate.opsForHash().get(
                            AdaptiveDifficultyService.ABUSE_GLOBAL_KEY, "total"))
                    .expectNext("1")
                    .verifyComplete();

            Duration ttl = redisTemplate.getExpire(AdaptiveDifficultyService.ABUSE_GLOBAL_KEY)
                    .block(Duration.ofSeconds(5));
            assertThat(ttl).isNotNull();
            assertThat(ttl.isNegative()).isFalse();
            assertThat(ttl).isLessThanOrEqualTo(Duration.ofSeconds(2));
        }

        @Test
        void recordRejectedIncrementsRejectedWithTtl() {
            StepVerifier.create(service.recordRejected())
                    .verifyComplete();

            StepVerifier.create(redisTemplate.opsForHash().get(
                            AdaptiveDifficultyService.ABUSE_GLOBAL_KEY, "rejected"))
                    .expectNext("1")
                    .verifyComplete();

            Duration ttl = redisTemplate.getExpire(AdaptiveDifficultyService.ABUSE_GLOBAL_KEY)
                    .block(Duration.ofSeconds(5));
            assertThat(ttl).isNotNull();
            assertThat(ttl.isNegative()).isFalse();
            assertThat(ttl).isLessThanOrEqualTo(Duration.ofSeconds(2));
        }

        @Test
        void abuseSignalDecaysAfterWindowExpires() throws InterruptedException {
            recordAttempts(5);
            recordRejections(3);

            StepVerifier.create(service.currentDifficulty(PowAction.SESSION_CREATE))
                    .expectNext(24)
                    .verifyComplete();

            Thread.sleep(Duration.ofSeconds(2).toMillis() + 500);

            StepVerifier.create(service.currentDifficulty(PowAction.SESSION_CREATE))
                    .expectNext(20)
                    .verifyComplete();
        }
    }

    private void recordAttempts(int count) {
        for (int i = 0; i < count; i++) {
            service.recordGatedAttempt().block(Duration.ofSeconds(5));
        }
    }

    private void recordRejections(int count) {
        for (int i = 0; i < count; i++) {
            service.recordRejected().block(Duration.ofSeconds(5));
        }
    }

    private static dev.burnedchats.config.PowProperties disabledProperties() {
        dev.burnedchats.config.PowProperties properties = new dev.burnedchats.config.PowProperties();
        properties.setEnabled(false);
        return properties;
    }

    private static ObjectProvider<AdaptiveDifficultyService.ReputationDifficultyResolver> nullReputationProvider() {
        return new ObjectProvider<>() {
            @Override
            public AdaptiveDifficultyService.ReputationDifficultyResolver getObject(Object... args) {
                return null;
            }

            @Override
            public AdaptiveDifficultyService.ReputationDifficultyResolver getIfAvailable() {
                return null;
            }

            @Override
            public AdaptiveDifficultyService.ReputationDifficultyResolver getIfUnique() {
                return null;
            }

            @Override
            public AdaptiveDifficultyService.ReputationDifficultyResolver getObject() {
                return null;
            }

            @Override
            public java.util.Iterator<AdaptiveDifficultyService.ReputationDifficultyResolver> iterator() {
                return java.util.Collections.emptyIterator();
            }
        };
    }
}

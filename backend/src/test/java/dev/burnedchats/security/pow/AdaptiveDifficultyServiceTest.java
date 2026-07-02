package dev.burnedchats.security.pow;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.connection.ReactiveRedisConnection;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.DockerImageName;
import reactor.test.StepVerifier;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for {@link AdaptiveDifficultyService} on real Redis (Testcontainers).
 */
@SpringBootTest
@ActiveProfiles("test")
@EnabledIf("dev.burnedchats.security.pow.AdaptiveDifficultyServiceTest#dockerAvailable")
@Tag("integration")
@DisplayName("AdaptiveDifficultyService (Redis integration)")
class AdaptiveDifficultyServiceTest {

    /**
     * Singleton Redis container started once for the whole test JVM and intentionally
     * never stopped per class (Testcontainers' Ryuk reaper reaps it at JVM exit).
     *
     * <p>The previous {@code @Container}/{@code @Testcontainers} lifecycle stopped the
     * container after this class finished, leaving the cached Spring context pointing at
     * the dead mapped port → {@code RedisConnectionFailureException} during {@code clean
     * build}. A singleton container keeps the mapped port stable for the entire JVM.
     * Mirrors {@code StompIntegrationTestBase}.
     */
    @SuppressWarnings("resource")
    private static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7-alpine"))
                    .withExposedPorts(6379)
                    // Wait until redis-server is actually accepting connections; the default
                    // port-listening probe can pass before redis is ready on Docker Desktop.
                    .waitingFor(Wait.forLogMessage(".*Ready to accept connections.*\\n", 1)
                            .withStartupTimeout(Duration.ofSeconds(60)));

    static {
        if (dockerAvailable()) {
            REDIS.start();
        }
    }

    /** Gate the suite on Docker availability without the per-class Testcontainers extension. */
    public static boolean dockerAvailable() {
        return DockerClientFactory.instance().isDockerAvailable();
    }

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
        // The connection MUST be closed: leaking one per test eventually exhausts/breaks the
        // reactive Lettuce pool, which surfaces mid-suite as RedisConnectionFailureException.
        ReactiveRedisConnection connection = redisTemplate.getConnectionFactory().getReactiveConnection();
        try {
            connection.serverCommands().flushDb().block(Duration.ofSeconds(5));
        } finally {
            connection.close();
        }
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
            // Mirror production (SessionLifecycleService.enforceSessionCreateGate): every gated
            // request first increments the total counter via recordGatedAttempt(); a rejected one
            // additionally increments the rejected counter. The abuse signal is rejected/total, so
            // a rejection must contribute to BOTH counters — otherwise the ratio is overstated.
            service.recordGatedAttempt().block(Duration.ofSeconds(5));
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
            public AdaptiveDifficultyService.ReputationDifficultyResolver getObject() {
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
            public java.util.Iterator<AdaptiveDifficultyService.ReputationDifficultyResolver> iterator() {
                return java.util.Collections.emptyIterator();
            }
        };
    }
}

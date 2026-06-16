package dev.burnedchats.security.pow;

import dev.burnedchats.config.PowProperties;
import dev.burnedchats.dto.request.PowSolution;
import dev.burnedchats.exception.PowInvalidException;
import dev.burnedchats.exception.PowRequiredException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
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
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for {@link PowVerificationService} on real Redis (Testcontainers).
 */
@SpringBootTest
@ActiveProfiles("test")
@Testcontainers(disabledWithoutDocker = true)
@Tag("integration")
@DisplayName("PowVerificationService (Redis integration)")
class PowVerificationServiceTest {

    private static final String NORMATIVE_CHALLENGE_ID = "00112233445566778899aabbccddeeff";
    private static final String NORMATIVE_NONCE = "1373";
    private static final int NORMATIVE_DIFFICULTY = 12;

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
        registry.add("pow.challenge-ttl", () -> "PT2S");
        registry.add("pow.replay-window", () -> "PT5S");
    }

    @Autowired
    private PowVerificationService verificationService;

    @Autowired
    private PowChallengeService challengeService;

    @Autowired
    private ReactiveRedisTemplate<String, String> redisTemplate;

    @Autowired
    private PowProperties properties;

    @BeforeEach
    void flushRedis() {
        redisTemplate.getConnectionFactory()
                .getReactiveConnection()
                .serverCommands()
                .flushDb()
                .block(Duration.ofSeconds(5));
    }

    @Test
    @DisplayName("accepts valid normative solution and consumes challenge")
    void acceptsValidSolution() {
        seedChallenge(NORMATIVE_CHALLENGE_ID, PowAction.SEARCH, NORMATIVE_DIFFICULTY);

        PowSolution solution = PowSolution.builder()
                .challengeId(NORMATIVE_CHALLENGE_ID)
                .nonce(NORMATIVE_NONCE)
                .build();

        StepVerifier.create(verificationService.verify(PowAction.SEARCH, solution))
                .verifyComplete();

        StepVerifier.create(redisTemplate.hasKey(PowChallengeService.challengeKey(NORMATIVE_CHALLENGE_ID)))
                .expectNext(false)
                .verifyComplete();
        StepVerifier.create(redisTemplate.hasKey(PowChallengeService.spentKey(NORMATIVE_CHALLENGE_ID)))
                .expectNext(true)
                .verifyComplete();
    }

    @Test
    @DisplayName("accepts solution from issued challenge")
    void acceptsSolutionFromIssuedChallenge() {
        var event = challengeService.issue(PowAction.SEARCH, 8).block(Duration.ofSeconds(5));
        assertThat(event).isNotNull();

        String nonce = findNonce(event.getChallengeId(), 8);
        PowSolution solution = PowSolution.builder()
                .challengeId(event.getChallengeId())
                .nonce(nonce)
                .build();

        StepVerifier.create(verificationService.verify(PowAction.SEARCH, solution))
                .verifyComplete();
    }

    @Test
    @DisplayName("invalid nonce → PowInvalidException")
    void invalidNonceRejected() {
        seedChallenge(NORMATIVE_CHALLENGE_ID, PowAction.SEARCH, NORMATIVE_DIFFICULTY);

        PowSolution solution = PowSolution.builder()
                .challengeId(NORMATIVE_CHALLENGE_ID)
                .nonce("0")
                .build();

        StepVerifier.create(verificationService.verify(PowAction.SEARCH, solution))
                .expectError(PowInvalidException.class)
                .verify();
    }

    @Test
    @DisplayName("missing solution fields → PowRequiredException")
    void missingSolutionRejected() {
        StepVerifier.create(verificationService.verify(PowAction.SEARCH, null))
                .expectError(PowRequiredException.class)
                .verify();

        StepVerifier.create(verificationService.verify(
                        PowAction.SEARCH, PowSolution.builder().challengeId("").nonce("0").build()))
                .expectError(PowRequiredException.class)
                .verify();
    }

    @Test
    @DisplayName("expired challenge → PowRequiredException")
    void expiredChallengeRejected() throws InterruptedException {
        seedChallenge(NORMATIVE_CHALLENGE_ID, PowAction.SEARCH, NORMATIVE_DIFFICULTY);

        Thread.sleep(properties.getChallengeTtl().toMillis() + 500);

        PowSolution solution = PowSolution.builder()
                .challengeId(NORMATIVE_CHALLENGE_ID)
                .nonce(NORMATIVE_NONCE)
                .build();

        StepVerifier.create(verificationService.verify(PowAction.SEARCH, solution))
                .expectError(PowRequiredException.class)
                .verify();
    }

    @Test
    @DisplayName("absent challenge → PowRequiredException")
    void absentChallengeRejected() {
        PowSolution solution = PowSolution.builder()
                .challengeId(NORMATIVE_CHALLENGE_ID)
                .nonce(NORMATIVE_NONCE)
                .build();

        StepVerifier.create(verificationService.verify(PowAction.SEARCH, solution))
                .expectError(PowRequiredException.class)
                .verify();
    }

    @Test
    @DisplayName("replay → PowInvalidException on second verify")
    void replayRejected() {
        seedChallenge(NORMATIVE_CHALLENGE_ID, PowAction.SEARCH, NORMATIVE_DIFFICULTY);

        PowSolution solution = PowSolution.builder()
                .challengeId(NORMATIVE_CHALLENGE_ID)
                .nonce(NORMATIVE_NONCE)
                .build();

        StepVerifier.create(verificationService.verify(PowAction.SEARCH, solution))
                .verifyComplete();

        StepVerifier.create(verificationService.verify(PowAction.SEARCH, solution))
                .expectError(PowInvalidException.class)
                .verify();
    }

    @Test
    @DisplayName("action mismatch → PowInvalidException")
    void actionMismatchRejected() {
        seedChallenge(NORMATIVE_CHALLENGE_ID, PowAction.SESSION_CREATE, NORMATIVE_DIFFICULTY);

        PowSolution solution = PowSolution.builder()
                .challengeId(NORMATIVE_CHALLENGE_ID)
                .nonce(NORMATIVE_NONCE)
                .build();

        StepVerifier.create(verificationService.verify(PowAction.SEARCH, solution))
                .expectError(PowInvalidException.class)
                .verify();
    }

    @Test
    @DisplayName("challenge and spent keys receive TTL")
    void keysHaveTtl() {
        var event = challengeService.issue(PowAction.SEARCH, 8).block(Duration.ofSeconds(5));
        assertThat(event).isNotNull();

        Duration challengeTtl = redisTemplate
                .getExpire(PowChallengeService.challengeKey(event.getChallengeId()))
                .block(Duration.ofSeconds(5));
        assertThat(challengeTtl).isNotNull();
        assertThat(challengeTtl.isNegative()).isFalse();
        assertThat(challengeTtl).isLessThanOrEqualTo(properties.getChallengeTtl());

        String nonce = findNonce(event.getChallengeId(), 8);
        PowSolution solution = PowSolution.builder()
                .challengeId(event.getChallengeId())
                .nonce(nonce)
                .build();
        verificationService.verify(PowAction.SEARCH, solution).block(Duration.ofSeconds(5));

        Duration spentTtl = redisTemplate
                .getExpire(PowChallengeService.spentKey(event.getChallengeId()))
                .block(Duration.ofSeconds(5));
        assertThat(spentTtl).isNotNull();
        assertThat(spentTtl.isNegative()).isFalse();
        assertThat(spentTtl).isLessThanOrEqualTo(properties.getReplayWindow());
    }

    @Test
    @DisplayName("pow.enabled=false → verify is a no-op")
    void verifyNoOpWhenDisabled() {
        PowProperties disabledProps = new PowProperties();
        disabledProps.setEnabled(false);
        PowVerificationService disabledService = new PowVerificationService(redisTemplate, disabledProps);

        seedChallenge(NORMATIVE_CHALLENGE_ID, PowAction.SEARCH, NORMATIVE_DIFFICULTY);
        PowSolution solution = PowSolution.builder()
                .challengeId(NORMATIVE_CHALLENGE_ID)
                .nonce(NORMATIVE_NONCE)
                .build();

        StepVerifier.create(disabledService.verify(PowAction.SEARCH, solution))
                .verifyComplete();

        StepVerifier.create(redisTemplate.hasKey(PowChallengeService.spentKey(NORMATIVE_CHALLENGE_ID)))
                .expectNext(false)
                .verifyComplete();
        StepVerifier.create(redisTemplate.hasKey(PowChallengeService.challengeKey(NORMATIVE_CHALLENGE_ID)))
                .expectNext(true)
                .verifyComplete();
    }

    @Test
    @DisplayName("concurrent double-spend — exactly one verify succeeds")
    void concurrentDoubleSpendOnlyOneSucceeds() throws InterruptedException {
        seedChallenge(NORMATIVE_CHALLENGE_ID, PowAction.SEARCH, NORMATIVE_DIFFICULTY);
        PowSolution solution = PowSolution.builder()
                .challengeId(NORMATIVE_CHALLENGE_ID)
                .nonce(NORMATIVE_NONCE)
                .build();

        int threads = 8;
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(threads);
        AtomicInteger successes = new AtomicInteger();
        AtomicInteger failures = new AtomicInteger();

        for (int i = 0; i < threads; i++) {
            Thread worker = new Thread(() -> {
                try {
                    start.await();
                    verificationService.verify(PowAction.SEARCH, solution).block(Duration.ofSeconds(5));
                    successes.incrementAndGet();
                } catch (Exception e) {
                    failures.incrementAndGet();
                } finally {
                    done.countDown();
                }
            });
            worker.start();
        }

        start.countDown();
        assertThat(done.await(10, TimeUnit.SECONDS)).isTrue();
        assertThat(successes.get()).isEqualTo(1);
        assertThat(failures.get()).isEqualTo(threads - 1);
    }

    private void seedChallenge(String challengeId, PowAction action, int difficulty) {
        String key = PowChallengeService.challengeKey(challengeId);
        Map<String, String> fields = Map.of(
                "action", action.wireValue(),
                "difficulty", String.valueOf(difficulty),
                "issuedAt", String.valueOf(System.currentTimeMillis())
        );
        redisTemplate.opsForHash().putAll(key, fields).block(Duration.ofSeconds(5));
        redisTemplate.expire(key, properties.getChallengeTtl()).block(Duration.ofSeconds(5));
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
}

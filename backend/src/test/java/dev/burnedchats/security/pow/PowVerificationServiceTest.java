package dev.burnedchats.security.pow;

import dev.burnedchats.config.PowProperties;
import dev.burnedchats.dto.request.PowSolution;
import dev.burnedchats.exception.PowInvalidException;
import dev.burnedchats.exception.PowRequiredException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.ReactiveHashOperations;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.ReactiveValueOperations;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link PowVerificationService}.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("PowVerificationService")
class PowVerificationServiceTest {

    private static final String CHALLENGE_ID = "00112233445566778899aabbccddeeff";
    private static final String VALID_NONCE = "1373";

    @Mock
    private ReactiveRedisTemplate<String, String> redisTemplate;

    @Mock
    private ReactiveValueOperations<String, String> valueOperations;

    @Mock
    private ReactiveHashOperations<String, Object, Object> hashOperations;

    private PowProperties properties;
    private PowVerificationService verificationService;

    @BeforeEach
    void setUp() {
        properties = new PowProperties();
        properties.setEnabled(true);
        properties.setReplayWindow(Duration.ofSeconds(120));

        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(redisTemplate.opsForHash()).thenReturn(hashOperations);

        verificationService = new PowVerificationService(redisTemplate, properties);
    }

    @Nested
    @DisplayName("when pow.enabled=false")
    class Disabled {

        @BeforeEach
        void disablePow() {
            properties.setEnabled(false);
        }

        @Test
        @DisplayName("verify is a no-op success")
        void verifyNoOp() {
            StepVerifier.create(verificationService.verify(
                    PowAction.SEARCH, PowSolution.builder().challengeId("x").nonce("0").build()))
                    .verifyComplete();

            verify(valueOperations, never()).setIfAbsent(anyString(), anyString(), any(Duration.class));
        }
    }

    @Nested
    @DisplayName("verify success path")
    class Success {

        @BeforeEach
        void stubHappyPath() {
            when(valueOperations.setIfAbsent(
                    eq(PowChallengeService.spentKey(CHALLENGE_ID)), eq("1"), any(Duration.class)))
                    .thenReturn(Mono.just(true));
            Map<Object, Object> challengeFields = new HashMap<>();
            challengeFields.put("action", PowAction.SEARCH.wireValue());
            challengeFields.put("difficulty", "12");
            challengeFields.put("issuedAt", "1700000000000");
            when(hashOperations.entries(PowChallengeService.challengeKey(CHALLENGE_ID)))
                    .thenReturn(Flux.fromIterable(challengeFields.entrySet()));
            when(redisTemplate.delete(PowChallengeService.challengeKey(CHALLENGE_ID)))
                    .thenReturn(Mono.just(1L));
        }

        @Test
        @DisplayName("accepts valid solution and deletes challenge key")
        void acceptsValidSolution() {
            PowSolution solution = PowSolution.builder()
                    .challengeId(CHALLENGE_ID)
                    .nonce(VALID_NONCE)
                    .build();

            StepVerifier.create(verificationService.verify(PowAction.SEARCH, solution))
                    .verifyComplete();

            verify(redisTemplate).delete(PowChallengeService.challengeKey(CHALLENGE_ID));
        }
    }

    @Nested
    @DisplayName("verify failure paths")
    class Failures {

        @Test
        @DisplayName("missing solution fields → PowRequiredException")
        void missingSolution() {
            StepVerifier.create(verificationService.verify(PowAction.SEARCH, null))
                    .expectError(PowRequiredException.class)
                    .verify();

            StepVerifier.create(verificationService.verify(
                    PowAction.SEARCH, PowSolution.builder().challengeId("").nonce("0").build()))
                    .expectError(PowRequiredException.class)
                    .verify();
        }

        @Test
        @DisplayName("replay → PowInvalidException")
        void replayRejected() {
            when(valueOperations.setIfAbsent(
                    eq(PowChallengeService.spentKey(CHALLENGE_ID)), eq("1"), any(Duration.class)))
                    .thenReturn(Mono.just(false));

            PowSolution solution = PowSolution.builder()
                    .challengeId(CHALLENGE_ID)
                    .nonce(VALID_NONCE)
                    .build();

            StepVerifier.create(verificationService.verify(PowAction.SEARCH, solution))
                    .expectError(PowInvalidException.class)
                    .verify();

            verify(hashOperations, never()).entries(anyString());
        }

        @Test
        @DisplayName("expired/missing challenge → PowRequiredException")
        void expiredChallenge() {
            when(valueOperations.setIfAbsent(
                    eq(PowChallengeService.spentKey(CHALLENGE_ID)), eq("1"), any(Duration.class)))
                    .thenReturn(Mono.just(true));
            when(hashOperations.entries(PowChallengeService.challengeKey(CHALLENGE_ID)))
                    .thenReturn(Flux.empty());

            PowSolution solution = PowSolution.builder()
                    .challengeId(CHALLENGE_ID)
                    .nonce(VALID_NONCE)
                    .build();

            StepVerifier.create(verificationService.verify(PowAction.SEARCH, solution))
                    .expectError(PowRequiredException.class)
                    .verify();
        }

        @Test
        @DisplayName("action mismatch → PowInvalidException")
        void actionMismatch() {
            when(valueOperations.setIfAbsent(
                    eq(PowChallengeService.spentKey(CHALLENGE_ID)), eq("1"), any(Duration.class)))
                    .thenReturn(Mono.just(true));
            Map<Object, Object> wrongActionFields = new HashMap<>();
            wrongActionFields.put("action", PowAction.SESSION_CREATE.wireValue());
            wrongActionFields.put("difficulty", "12");
            when(hashOperations.entries(PowChallengeService.challengeKey(CHALLENGE_ID)))
                    .thenReturn(Flux.fromIterable(wrongActionFields.entrySet()));

            PowSolution solution = PowSolution.builder()
                    .challengeId(CHALLENGE_ID)
                    .nonce(VALID_NONCE)
                    .build();

            StepVerifier.create(verificationService.verify(PowAction.SEARCH, solution))
                    .expectError(PowInvalidException.class)
                    .verify();
        }

        @Test
        @DisplayName("invalid nonce → PowInvalidException")
        void invalidNonce() {
            when(valueOperations.setIfAbsent(
                    eq(PowChallengeService.spentKey(CHALLENGE_ID)), eq("1"), any(Duration.class)))
                    .thenReturn(Mono.just(true));
            Map<Object, Object> searchFields = new HashMap<>();
            searchFields.put("action", PowAction.SEARCH.wireValue());
            searchFields.put("difficulty", "12");
            when(hashOperations.entries(PowChallengeService.challengeKey(CHALLENGE_ID)))
                    .thenReturn(Flux.fromIterable(searchFields.entrySet()));

            PowSolution solution = PowSolution.builder()
                    .challengeId(CHALLENGE_ID)
                    .nonce("0")
                    .build();

            StepVerifier.create(verificationService.verify(PowAction.SEARCH, solution))
                    .expectError(PowInvalidException.class)
                    .verify();
        }
    }
}

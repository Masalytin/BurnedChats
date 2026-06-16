package dev.burnedchats.security.pow;

import dev.burnedchats.config.PowProperties;
import dev.burnedchats.dto.event.PowChallengeEvent;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Map;

/**
 * Issues short-lived PoW challenges (DESIGN.md §3).
 */
@Service
@RequiredArgsConstructor
public class PowChallengeService {

    private static final String CHALLENGE_KEY_PREFIX = "pow:challenge:";
    private static final String FIELD_ACTION = "action";
    private static final String FIELD_DIFFICULTY = "difficulty";
    private static final String FIELD_ISSUED_AT = "issuedAt";

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final PowProperties properties;

    /**
     * Issue a new PoW challenge for the given action and difficulty.
     *
     * @param action     gated action
     * @param difficulty target leading zero bits (from adaptive resolver in ASPOW-04)
     * @return issued challenge event
     */
    public Mono<PowChallengeEvent> issue(PowAction action, int difficulty) {
        if (!properties.isEnabled()) {
            return Mono.just(buildDisabledChallenge(action));
        }

        String challengeId = generateChallengeId();
        long issuedAtMs = Instant.now().toEpochMilli();
        int effectiveDifficulty = Math.min(difficulty, properties.getCeiling());
        long ttlMs = properties.getChallengeTtl().toMillis();

        Map<String, String> hash = Map.of(
                FIELD_ACTION, action.wireValue(),
                FIELD_DIFFICULTY, String.valueOf(effectiveDifficulty),
                FIELD_ISSUED_AT, String.valueOf(issuedAtMs)
        );

        String key = challengeKey(challengeId);

        return redisTemplate.opsForHash()
                .putAll(key, hash)
                .then(redisTemplate.expire(key, properties.getChallengeTtl()))
                .thenReturn(PowChallengeEvent.builder()
                        .challengeId(challengeId)
                        .action(action.wireValue())
                        .difficulty(effectiveDifficulty)
                        .ttlMs(ttlMs)
                        .build());
    }

    /**
     * Issue a challenge using the configured base difficulty for the action.
     *
     * @param action gated action
     * @return issued challenge event
     */
    public Mono<PowChallengeEvent> issue(PowAction action) {
        return issue(action, properties.baseDifficultyFor(action));
    }

    private PowChallengeEvent buildDisabledChallenge(PowAction action) {
        return PowChallengeEvent.builder()
                .challengeId(generateChallengeId())
                .action(action.wireValue())
                .difficulty(0)
                .ttlMs(properties.getChallengeTtl().toMillis())
                .build();
    }

    private static String generateChallengeId() {
        byte[] bytes = new byte[16];
        SECURE_RANDOM.nextBytes(bytes);
        StringBuilder hex = new StringBuilder(32);
        for (byte b : bytes) {
            hex.append(String.format("%02x", b));
        }
        return hex.toString();
    }

    static String challengeKey(String challengeId) {
        return CHALLENGE_KEY_PREFIX + challengeId;
    }

    static String spentKey(String challengeId) {
        return "pow:spent:" + challengeId;
    }
}

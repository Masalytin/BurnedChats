package dev.burnedchats.security.pow;

import dev.burnedchats.config.PowProperties;
import dev.burnedchats.dto.request.PowSolution;
import dev.burnedchats.exception.PowInvalidException;
import dev.burnedchats.exception.PowRequiredException;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.util.Map;

/**
 * Verifies PoW solutions with atomic one-time-use (DESIGN.md §4.2, §6.2).
 */
@Service
@RequiredArgsConstructor
public class PowVerificationService {

    private static final String SPENT_VALUE = "1";
    private static final String FIELD_ACTION = "action";
    private static final String FIELD_DIFFICULTY = "difficulty";

    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final PowProperties properties;

    /**
     * Verify a PoW solution for the requested gated action.
     *
     * <p>Order per DESIGN.md §6.2: atomic spent claim, then challenge load, action check,
     * and hash verification. Deletes the challenge key on success.
     *
     * @param action   expected gated action for this request
     * @param solution client-submitted solution
     * @return empty Mono on success
     * @throws PowRequiredException if solution missing or challenge expired
     * @throws PowInvalidException  if replay, action mismatch, or insufficient difficulty
     */
    public Mono<Void> verify(PowAction action, PowSolution solution) {
        if (!properties.isEnabled()) {
            return Mono.empty();
        }

        if (solution == null || isBlank(solution.getChallengeId()) || isBlank(solution.getNonce())) {
            return Mono.error(new PowRequiredException());
        }

        String challengeId = solution.getChallengeId();
        String spentKey = PowChallengeService.spentKey(challengeId);
        String challengeKey = PowChallengeService.challengeKey(challengeId);

        return redisTemplate.opsForValue()
                .setIfAbsent(spentKey, SPENT_VALUE, properties.getReplayWindow())
                .flatMap(claimed -> {
                    if (!Boolean.TRUE.equals(claimed)) {
                        return Mono.error(PowInvalidException.alreadySpent());
                    }
                    return redisTemplate.opsForHash()
                            .entries(challengeKey)
                            .collectMap(
                                    entry -> String.valueOf(entry.getKey()),
                                    entry -> String.valueOf(entry.getValue())
                            )
                            .flatMap(fields -> validateAndConsume(
                                    action, solution, challengeKey, fields));
                });
    }

    private Mono<Void> validateAndConsume(
            PowAction action,
            PowSolution solution,
            String challengeKey,
            Map<String, String> fields) {
        if (fields.isEmpty()) {
            return Mono.error(new PowRequiredException());
        }

        String storedAction = fields.get(FIELD_ACTION);
        if (storedAction == null || !action.wireValue().equals(storedAction)) {
            return Mono.error(PowInvalidException.actionMismatch());
        }

        int difficulty = parseDifficulty(fields.get(FIELD_DIFFICULTY));

        if (!PowHash.meetsDifficulty(solution.getChallengeId(), solution.getNonce(), difficulty)) {
            return Mono.error(PowInvalidException.insufficientDifficulty());
        }

        return redisTemplate.delete(challengeKey).then();
    }

    private static int parseDifficulty(String raw) {
        if (raw == null) {
            return 0;
        }
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}

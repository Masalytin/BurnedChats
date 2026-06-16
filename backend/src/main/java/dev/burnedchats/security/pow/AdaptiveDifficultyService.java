package dev.burnedchats.security.pow;

import dev.burnedchats.config.PowProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.List;

/**
 * Layer-1 adaptive PoW difficulty from global abuse signal (DESIGN.md §5.2).
 *
 * <p>Maintains {@code pow:abuse:global} (hash: rejected/total counters, sliding TTL).
 * Optional {@link ReputationDifficultyResolver} bean (IMP-ASPOW-05) may reduce difficulty.
 */
@Service
@RequiredArgsConstructor
public class AdaptiveDifficultyService {

    static final String ABUSE_GLOBAL_KEY = "pow:abuse:global";
    private static final String FIELD_REJECTED = "rejected";
    private static final String FIELD_TOTAL = "total";

    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final PowProperties properties;
    private final ObjectProvider<ReputationDifficultyResolver> reputationResolver;

    /**
     * Optional Layer-2 seam — implemented by IMP-ASPOW-05 when staking bypass is enabled.
     */
    public interface ReputationDifficultyResolver {

        /**
         * Difficulty discount in bits for the given action (subtracted after Layer-1 resolution).
         */
        Mono<Integer> reputationDiscount(PowAction action);
    }

    /**
     * Record a gated action attempt (increments total counter).
     */
    public Mono<Void> recordGatedAttempt() {
        if (!properties.isEnabled()) {
            return Mono.empty();
        }
        return incrementCounter(FIELD_TOTAL);
    }

    /**
     * Record a rejected gated request (invalid/missing PoW).
     */
    public Mono<Void> recordRejected() {
        if (!properties.isEnabled()) {
            return Mono.empty();
        }
        return incrementCounter(FIELD_REJECTED);
    }

    /**
     * Resolve current difficulty for issuing a challenge.
     */
    public Mono<Integer> currentDifficulty(PowAction action) {
        if (!properties.isEnabled()) {
            return Mono.just(0);
        }

        int base = properties.baseDifficultyFor(action);
        return readAbuseSignal()
                .map(signal -> resolveDifficulty(base, signal, properties.getCeiling()))
                .flatMap(difficulty -> applyReputationDiscount(action, difficulty));
    }

    private Mono<Integer> applyReputationDiscount(PowAction action, int difficulty) {
        ReputationDifficultyResolver resolver = reputationResolver.getIfAvailable();
        if (resolver == null) {
            return Mono.just(difficulty);
        }
        return resolver.reputationDiscount(action)
                .defaultIfEmpty(0)
                .map(discount -> Math.max(0, difficulty - discount));
    }

    private Mono<Void> incrementCounter(String field) {
        Duration window = properties.getAbuseWindow();
        return redisTemplate.opsForHash()
                .increment(ABUSE_GLOBAL_KEY, field, 1L)
                .then(redisTemplate.expire(ABUSE_GLOBAL_KEY, window))
                .then();
    }

    private Mono<Double> readAbuseSignal() {
        return redisTemplate.opsForHash()
                .multiGet(ABUSE_GLOBAL_KEY, List.of(FIELD_REJECTED, FIELD_TOTAL))
                .map(values -> {
                    long rejected = parseCounter(values != null && !values.isEmpty() ? values.get(0) : null);
                    long total = parseCounter(values != null && values.size() > 1 ? values.get(1) : null);
                    return (double) rejected / Math.max(1L, total);
                });
    }

    private static long parseCounter(Object raw) {
        if (raw == null) {
            return 0L;
        }
        try {
            return Long.parseLong(String.valueOf(raw));
        } catch (NumberFormatException e) {
            return 0L;
        }
    }

    /**
     * DESIGN.md §5.2 bump table.
     */
    static int bumpForSignal(double signal) {
        if (signal < 0.10) {
            return 0;
        }
        if (signal < 0.25) {
            return 2;
        }
        if (signal < 0.50) {
            return 4;
        }
        return 6;
    }

    static int resolveDifficulty(int base, double signal, int ceiling) {
        return Math.min(base + bumpForSignal(signal), ceiling);
    }
}

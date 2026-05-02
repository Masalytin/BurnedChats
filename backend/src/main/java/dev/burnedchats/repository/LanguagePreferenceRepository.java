package dev.burnedchats.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;
import dev.burnedchats.util.InternalIds;

import java.time.Duration;

/**
 * Redis repository for user language preferences.
 * Key: lang:pref:{userId}, TTL: 90 days.
 */
@Repository
@RequiredArgsConstructor
@SuppressWarnings("checkstyle:OverloadMethodsDeclarationOrder")
public class LanguagePreferenceRepository {

    private static final String KEY_PREFIX = "lang:pref:";
    private static final Duration TTL = Duration.ofDays(90);

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    public Mono<Boolean> save(String userId, String languageCode) {
        return redisTemplate.opsForValue()
                .set(KEY_PREFIX + userId, languageCode, TTL);
    }

    public Mono<String> findByUserId(String userId) {
        return redisTemplate.opsForValue()
                .get(KEY_PREFIX + userId);
    }

    public Mono<Boolean> save(Long userId, String languageCode) {
        return save(InternalIds.forTelegramId(userId), languageCode);
    }

    public Mono<String> findByUserId(Long userId) {
        return findByUserId(InternalIds.forTelegramId(userId));
    }
}

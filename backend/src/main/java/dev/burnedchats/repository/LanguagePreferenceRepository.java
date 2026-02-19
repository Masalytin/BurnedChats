package dev.burnedchats.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

import java.time.Duration;

/**
 * Redis repository for user language preferences.
 * Key: lang:pref:{userId}, TTL: 90 days.
 */
@Repository
@RequiredArgsConstructor
public class LanguagePreferenceRepository {

    private static final String KEY_PREFIX = "lang:pref:";
    private static final Duration TTL = Duration.ofDays(90);

    private final ReactiveStringRedisTemplate stringRedisTemplate;

    public Mono<Boolean> save(Long userId, String languageCode) {
        return stringRedisTemplate.opsForValue()
                .set(KEY_PREFIX + userId, languageCode, TTL);
    }

    public Mono<String> findByUserId(Long userId) {
        return stringRedisTemplate.opsForValue()
                .get(KEY_PREFIX + userId);
    }
}

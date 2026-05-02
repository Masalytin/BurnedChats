package dev.burnedchats.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;

/**
 * Issues and validates opaque wallet session tokens stored in Redis.
 */
@Service
public class SessionTokenService {

    private static final String SESSION_TOKEN_PREFIX = "session_token:";
    private static final int TOKEN_BYTES = 32;

    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final Duration tokenTtl;
    private final SecureRandom secureRandom = new SecureRandom();

    public SessionTokenService(
            ReactiveRedisTemplate<String, String> redisTemplate,
            @Value("${burnedchats.wallet-auth.session-token-ttl:PT1H}") Duration tokenTtl) {
        this.redisTemplate = redisTemplate;
        this.tokenTtl = tokenTtl;
    }

    /**
     * Create new opaque session token for user internal id.
     */
    public Mono<String> issueToken(String internalId) {
        if (internalId == null || internalId.isBlank()) {
            return Mono.error(new IllegalArgumentException("internalId is required"));
        }
        String token = generateToken();
        String key = tokenKey(token);
        return redisTemplate.opsForValue()
                .set(key, internalId, tokenTtl)
                .flatMap(saved -> Boolean.TRUE.equals(saved)
                        ? Mono.just(token)
                        : Mono.error(new IllegalStateException("Failed to persist session token")));
    }

    /**
     * Resolve token to internal id and refresh TTL.
     */
    public Mono<String> validateAndRefresh(String token) {
        if (token == null || token.isBlank()) {
            return Mono.empty();
        }
        String trimmed = token.trim();
        String key = tokenKey(trimmed);
        return redisTemplate.opsForValue()
                .get(key)
                .flatMap(internalId -> redisTemplate.opsForValue()
                        .set(key, internalId, tokenTtl)
                        .flatMap(refreshed -> Boolean.TRUE.equals(refreshed)
                                ? Mono.just(internalId)
                                : Mono.empty()));
    }

    private String tokenKey(String token) {
        return SESSION_TOKEN_PREFIX + token;
    }

    private String generateToken() {
        byte[] bytes = new byte[TOKEN_BYTES];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}

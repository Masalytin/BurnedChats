package dev.burnedchats.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.Map;

/**
 * Service for Redis health checks and diagnostics.
 *
 * <p>Provides reactive methods to check Redis connectivity
 * and retrieve server information.
 */
@Service
public class RedisHealthService {

    private static final Logger LOG = LoggerFactory.getLogger(RedisHealthService.class);

    private static final Duration PING_TIMEOUT = Duration.ofSeconds(5);

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    public RedisHealthService(ReactiveRedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * Check if Redis is reachable by sending PING command.
     *
     * @return Mono emitting true if Redis responds with PONG, false otherwise
     */
    public Mono<Boolean> isHealthy() {
        return redisTemplate.getConnectionFactory()
                .getReactiveConnection()
                .ping()
                .map("PONG"::equals)
                .timeout(PING_TIMEOUT)
                .onErrorResume(e -> {
                    LOG.warn("Redis health check failed: {}", e.getMessage());
                    return Mono.just(false);
                });
    }

    /**
     * Get Redis connection details for health endpoint.
     *
     * @return Mono emitting health details map
     */
    public Mono<Map<String, Object>> getHealthDetails() {
        return isHealthy()
                .map(healthy -> Map.<String, Object>of(
                        "status", healthy ? "UP" : "DOWN",
                        "type", "redis",
                        "client", "lettuce"
                ));
    }

    /**
     * Execute a simple write/read test to verify full Redis functionality.
     *
     * @return Mono emitting true if write/read succeeds
     */
    public Mono<Boolean> verifyWriteRead() {
        String testKey = "health:test:" + System.currentTimeMillis();
        String testValue = "ok";

        return redisTemplate.opsForValue()
                .set(testKey, testValue, Duration.ofSeconds(10))
                .flatMap(success -> redisTemplate.opsForValue().get(testKey))
                .map(testValue::equals)
                .doFinally(signal -> redisTemplate.delete(testKey).subscribe())
                .timeout(PING_TIMEOUT)
                .onErrorResume(e -> {
                    LOG.warn("Redis write/read test failed: {}", e.getMessage());
                    return Mono.just(false);
                });
    }
}


package dev.burnedchats.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.connection.ReactiveRedisConnection;
import org.springframework.data.redis.connection.ReactiveRedisConnectionFactory;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.ReactiveValueOperations;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for RedisHealthService.
 *
 * <p>Tests health check functionality with mocked Redis operations.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("RedisHealthService")
class RedisHealthServiceTest {

    @Mock
    private ReactiveRedisTemplate<String, String> redisTemplate;

    @Mock
    private ReactiveRedisConnectionFactory connectionFactory;

    @Mock
    private ReactiveRedisConnection connection;

    @Mock
    private ReactiveValueOperations<String, String> valueOperations;

    private RedisHealthService healthService;

    @BeforeEach
    void setUp() {
        when(redisTemplate.getConnectionFactory()).thenReturn(connectionFactory);
        healthService = new RedisHealthService(redisTemplate);
    }

    @Nested
    @DisplayName("isHealthy")
    class IsHealthy {

        @Test
        @DisplayName("should return true when Redis responds PONG")
        void shouldReturnTrueWhenRedisRespondsPong() {
            // Given
            when(connectionFactory.getReactiveConnection()).thenReturn(connection);
            when(connection.ping()).thenReturn(Mono.just("PONG"));

            // When & Then
            StepVerifier.create(healthService.isHealthy())
                    .expectNext(true)
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return false when Redis responds with unexpected value")
        void shouldReturnFalseWhenUnexpectedResponse() {
            // Given
            when(connectionFactory.getReactiveConnection()).thenReturn(connection);
            when(connection.ping()).thenReturn(Mono.just("UNEXPECTED"));

            // When & Then
            StepVerifier.create(healthService.isHealthy())
                    .expectNext(false)
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return false when connection fails")
        void shouldReturnFalseWhenConnectionFails() {
            // Given
            when(connectionFactory.getReactiveConnection()).thenReturn(connection);
            when(connection.ping()).thenReturn(Mono.error(new RuntimeException("Connection refused")));

            // When & Then
            StepVerifier.create(healthService.isHealthy())
                    .expectNext(false)
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return false on timeout")
        void shouldReturnFalseOnTimeout() {
            // Given
            when(connectionFactory.getReactiveConnection()).thenReturn(connection);
            when(connection.ping()).thenReturn(Mono.never()); // Never completes = timeout

            // When & Then - use virtual time for timeout testing
            StepVerifier.withVirtualTime(() -> healthService.isHealthy())
                    .thenAwait(Duration.ofSeconds(6)) // Wait longer than 5s timeout
                    .expectNext(false)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("getHealthDetails")
    class GetHealthDetails {

        @Test
        @DisplayName("should return UP status when healthy")
        void shouldReturnUpStatusWhenHealthy() {
            // Given
            when(connectionFactory.getReactiveConnection()).thenReturn(connection);
            when(connection.ping()).thenReturn(Mono.just("PONG"));

            // When & Then
            StepVerifier.create(healthService.getHealthDetails())
                    .assertNext(details -> {
                        assertEquals("UP", details.get("status"));
                        assertEquals("redis", details.get("type"));
                        assertEquals("lettuce", details.get("client"));
                    })
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return DOWN status when unhealthy")
        void shouldReturnDownStatusWhenUnhealthy() {
            // Given
            when(connectionFactory.getReactiveConnection()).thenReturn(connection);
            when(connection.ping()).thenReturn(Mono.error(new RuntimeException("Connection refused")));

            // When & Then
            StepVerifier.create(healthService.getHealthDetails())
                    .assertNext(details -> {
                        assertEquals("DOWN", details.get("status"));
                        assertEquals("redis", details.get("type"));
                        assertEquals("lettuce", details.get("client"));
                    })
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("verifyWriteRead")
    class VerifyWriteRead {

        @Test
        @DisplayName("should return true when write/read succeeds")
        void shouldReturnTrueWhenWriteReadSucceeds() {
            // Given
            when(redisTemplate.opsForValue()).thenReturn(valueOperations);
            when(valueOperations.set(anyString(), eq("ok"), any(Duration.class)))
                    .thenReturn(Mono.just(true));
            when(valueOperations.get(anyString())).thenReturn(Mono.just("ok"));
            when(redisTemplate.delete(anyString())).thenReturn(Mono.just(1L));

            // When & Then
            StepVerifier.create(healthService.verifyWriteRead())
                    .expectNext(true)
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return false when read returns different value")
        void shouldReturnFalseWhenReadReturnsDifferentValue() {
            // Given
            when(redisTemplate.opsForValue()).thenReturn(valueOperations);
            when(valueOperations.set(anyString(), eq("ok"), any(Duration.class)))
                    .thenReturn(Mono.just(true));
            when(valueOperations.get(anyString())).thenReturn(Mono.just("different"));
            when(redisTemplate.delete(anyString())).thenReturn(Mono.just(1L));

            // When & Then
            StepVerifier.create(healthService.verifyWriteRead())
                    .expectNext(false)
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return false when write fails")
        void shouldReturnFalseWhenWriteFails() {
            // Given
            when(redisTemplate.opsForValue()).thenReturn(valueOperations);
            when(valueOperations.set(anyString(), eq("ok"), any(Duration.class)))
                    .thenReturn(Mono.error(new RuntimeException("Write failed")));
            when(redisTemplate.delete(anyString())).thenReturn(Mono.just(0L));

            // When & Then
            StepVerifier.create(healthService.verifyWriteRead())
                    .expectNext(false)
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return false when read fails")
        void shouldReturnFalseWhenReadFails() {
            // Given
            when(redisTemplate.opsForValue()).thenReturn(valueOperations);
            when(valueOperations.set(anyString(), eq("ok"), any(Duration.class)))
                    .thenReturn(Mono.just(true));
            when(valueOperations.get(anyString()))
                    .thenReturn(Mono.error(new RuntimeException("Read failed")));
            when(redisTemplate.delete(anyString())).thenReturn(Mono.just(0L));

            // When & Then
            StepVerifier.create(healthService.verifyWriteRead())
                    .expectNext(false)
                    .verifyComplete();
        }

        @Test
        @DisplayName("should cleanup test key on completion")
        void shouldCleanupTestKeyOnCompletion() {
            // Given
            when(redisTemplate.opsForValue()).thenReturn(valueOperations);
            when(valueOperations.set(anyString(), eq("ok"), any(Duration.class)))
                    .thenReturn(Mono.just(true));
            when(valueOperations.get(anyString())).thenReturn(Mono.just("ok"));
            when(redisTemplate.delete(anyString())).thenReturn(Mono.just(1L));

            // When
            healthService.verifyWriteRead().block();

            // Then - verify delete was called (in doFinally)
            verify(redisTemplate, atLeastOnce()).delete(argThat((String key) -> 
                    key != null && key.startsWith("health:test:")));
        }

        @Test
        @DisplayName("should return false on timeout")
        void shouldReturnFalseOnTimeout() {
            // Given
            when(redisTemplate.opsForValue()).thenReturn(valueOperations);
            when(valueOperations.set(anyString(), eq("ok"), any(Duration.class)))
                    .thenReturn(Mono.never()); // Never completes
            when(redisTemplate.delete(anyString())).thenReturn(Mono.just(0L));

            // When & Then - use virtual time for timeout testing
            StepVerifier.withVirtualTime(() -> healthService.verifyWriteRead())
                    .thenAwait(Duration.ofSeconds(6)) // Wait longer than 5s timeout
                    .expectNext(false)
                    .verifyComplete();
        }
    }
}

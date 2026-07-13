package dev.burnedchats.repository;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.ReactiveHashOperations;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("UserRepository")
class UserRepositoryTest {

    @Mock
    private ReactiveRedisTemplate<String, String> redisTemplate;

    @Mock
    private ReactiveHashOperations<String, Object, Object> hashOperations;

    private UserRepository repository;

    @BeforeEach
    void setUp() {
        when(redisTemplate.<Object, Object>opsForHash()).thenReturn(hashOperations);
        repository = new UserRepository(redisTemplate);
    }

    private static Flux<Map.Entry<Object, Object>> userHashEntries(long id, String username) {
        return Flux.just(
                Map.entry("id", String.valueOf(id)),
                Map.entry("username", username),
                Map.entry("firstName", "Test"));
    }

    /**
     * Regression test for the production username-search outage: dead man's switch keys
     * ({@code user:deadman:*}, plain String values) live in the same {@code user:*} namespace
     * that findByUsername scans with HGETALL. The scan must skip such sub-namespace keys
     * instead of failing the whole search with WRONGTYPE.
     */
    @Test
    void findByUsername_ignoresDeadmanSubNamespaceKeys() {
        String deadmanKey = "user:deadman:5df6c22a-7546-429c-9134-d7630c3164d9";
        String deadmanCfgKey = "user:deadman:cfg:5df6c22a-7546-429c-9134-d7630c3164d9";
        String userKey = "user:701498683";

        when(redisTemplate.keys("user:*"))
                .thenReturn(Flux.just(deadmanKey, deadmanCfgKey, userKey));
        when(hashOperations.entries(deadmanKey)).thenReturn(Flux.error(new RuntimeException(
                "WRONGTYPE Operation against a key holding the wrong kind of value")));
        when(hashOperations.entries(deadmanCfgKey)).thenReturn(Flux.error(new RuntimeException(
                "WRONGTYPE Operation against a key holding the wrong kind of value")));
        when(hashOperations.entries(userKey)).thenReturn(userHashEntries(701498683L, "DenisMSL"));

        StepVerifier.create(repository.findByUsername("denismsl"))
                .assertNext(user -> {
                    assertEquals(701498683L, user.getId());
                    assertEquals("DenisMSL", user.getUsername());
                })
                .verifyComplete();

        verify(hashOperations, never()).entries(deadmanKey);
        verify(hashOperations, never()).entries(deadmanCfgKey);
    }

    @Test
    void findByUsername_survivesWrongTypeErrorOnSingleKey() {
        String badKey = "user:999";
        String userKey = "user:701498683";

        when(redisTemplate.keys("user:*")).thenReturn(Flux.just(badKey, userKey));
        when(hashOperations.entries(badKey)).thenReturn(Flux.error(new RuntimeException(
                "WRONGTYPE Operation against a key holding the wrong kind of value")));
        when(hashOperations.entries(userKey)).thenReturn(userHashEntries(701498683L, "DenisMSL"));

        StepVerifier.create(repository.findByUsername("@DenisMSL"))
                .assertNext(user -> assertEquals("DenisMSL", user.getUsername()))
                .verifyComplete();
    }

    @Test
    void findByUsername_returnsEmptyWhenNoMatch() {
        String userKey = "user:701498683";

        when(redisTemplate.keys("user:*")).thenReturn(Flux.just(userKey));
        when(hashOperations.entries(userKey)).thenReturn(userHashEntries(701498683L, "DenisMSL"));

        StepVerifier.create(repository.findByUsername("someoneelse"))
                .verifyComplete();
    }
}

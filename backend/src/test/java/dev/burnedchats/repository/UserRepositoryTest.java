package dev.burnedchats.repository;

import dev.burnedchats.model.TelegramUser;
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
import org.springframework.data.redis.core.ReactiveValueOperations;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Duration;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("UserRepository")
class UserRepositoryTest {

    private static final Duration USER_TTL = Duration.ofDays(7);
    private static final long TG_ID = 701498683L;
    private static final String USER_KEY = "user:" + TG_ID;
    private static final String INDEX_KEY = "username_idx:denismsl";

    @Mock
    private ReactiveRedisTemplate<String, String> redisTemplate;

    @Mock
    private ReactiveHashOperations<String, Object, Object> hashOperations;

    @Mock
    private ReactiveValueOperations<String, String> valueOperations;

    private UserRepository repository;

    @BeforeEach
    void setUp() {
        when(redisTemplate.<Object, Object>opsForHash()).thenReturn(hashOperations);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(redisTemplate.expire(anyString(), any(Duration.class))).thenReturn(Mono.just(true));
        when(valueOperations.set(anyString(), anyString(), any(Duration.class))).thenReturn(Mono.just(true));
        when(redisTemplate.delete(anyString())).thenReturn(Mono.just(1L));
        repository = new UserRepository(redisTemplate);
    }

    private static Flux<Map.Entry<Object, Object>> userHashEntries(long id, String username) {
        return Flux.just(
                Map.entry("id", String.valueOf(id)),
                Map.entry("username", username),
                Map.entry("firstName", "Test"));
    }

    private void stubIndexMiss(String indexKey) {
        when(valueOperations.get(indexKey)).thenReturn(Mono.empty());
    }

    @Test
    void findByUsername_hitsIndex_doesNotScanKeys() {
        when(valueOperations.get(INDEX_KEY)).thenReturn(Mono.just(String.valueOf(TG_ID)));
        when(hashOperations.entries(USER_KEY)).thenReturn(userHashEntries(TG_ID, "DenisMSL"));

        StepVerifier.create(repository.findByUsername("@DenisMSL"))
                .assertNext(user -> {
                    assertEquals(TG_ID, user.getId());
                    assertEquals("DenisMSL", user.getUsername());
                })
                .verifyComplete();

        verify(redisTemplate, never()).keys(anyString());
    }

    @Test
    void findByUsername_indexMiss_fallsBackToScanAndFillsIndex() {
        stubIndexMiss(INDEX_KEY);
        when(redisTemplate.keys("user:*")).thenReturn(Flux.just(USER_KEY));
        when(hashOperations.entries(USER_KEY)).thenReturn(userHashEntries(TG_ID, "DenisMSL"));

        StepVerifier.create(repository.findByUsername("denismsl"))
                .assertNext(user -> {
                    assertEquals(TG_ID, user.getId());
                    assertEquals("DenisMSL", user.getUsername());
                })
                .verifyComplete();

        verify(valueOperations).set(eq(INDEX_KEY), eq(String.valueOf(TG_ID)), eq(USER_TTL));
    }

    /**
     * Regression test for the production username-search outage: dead man's switch keys
     * ({@code user:deadman:*}, plain String values) live in the same {@code user:*} namespace
     * that the fallback scan still walks with HGETALL. The scan must skip such sub-namespace
     * keys instead of failing the whole search with WRONGTYPE.
     */
    @Test
    void findByUsername_ignoresDeadmanSubNamespaceKeys() {
        String deadmanKey = "user:deadman:5df6c22a-7546-429c-9134-d7630c3164d9";
        String deadmanCfgKey = "user:deadman:cfg:5df6c22a-7546-429c-9134-d7630c3164d9";

        stubIndexMiss(INDEX_KEY);
        when(redisTemplate.keys("user:*"))
                .thenReturn(Flux.just(deadmanKey, deadmanCfgKey, USER_KEY));
        when(hashOperations.entries(deadmanKey)).thenReturn(Flux.error(new RuntimeException(
                "WRONGTYPE Operation against a key holding the wrong kind of value")));
        when(hashOperations.entries(deadmanCfgKey)).thenReturn(Flux.error(new RuntimeException(
                "WRONGTYPE Operation against a key holding the wrong kind of value")));
        when(hashOperations.entries(USER_KEY)).thenReturn(userHashEntries(TG_ID, "DenisMSL"));

        StepVerifier.create(repository.findByUsername("denismsl"))
                .assertNext(user -> {
                    assertEquals(TG_ID, user.getId());
                    assertEquals("DenisMSL", user.getUsername());
                })
                .verifyComplete();

        verify(hashOperations, never()).entries(deadmanKey);
        verify(hashOperations, never()).entries(deadmanCfgKey);
    }

    @Test
    void findByUsername_survivesWrongTypeErrorOnSingleKey() {
        String badKey = "user:999";

        stubIndexMiss(INDEX_KEY);
        when(redisTemplate.keys("user:*")).thenReturn(Flux.just(badKey, USER_KEY));
        when(hashOperations.entries(badKey)).thenReturn(Flux.error(new RuntimeException(
                "WRONGTYPE Operation against a key holding the wrong kind of value")));
        when(hashOperations.entries(USER_KEY)).thenReturn(userHashEntries(TG_ID, "DenisMSL"));

        StepVerifier.create(repository.findByUsername("@DenisMSL"))
                .assertNext(user -> assertEquals("DenisMSL", user.getUsername()))
                .verifyComplete();
    }

    @Test
    void findByUsername_returnsEmptyWhenNoMatch() {
        stubIndexMiss("username_idx:someoneelse");
        when(redisTemplate.keys("user:*")).thenReturn(Flux.just(USER_KEY));
        when(hashOperations.entries(USER_KEY)).thenReturn(userHashEntries(TG_ID, "DenisMSL"));

        StepVerifier.create(repository.findByUsername("someoneelse"))
                .verifyComplete();

        verify(valueOperations, never()).set(eq("username_idx:someoneelse"), anyString(), any(Duration.class));
    }

    @Test
    void save_writesIndexWithMatchingTtl() {
        TelegramUser user = TelegramUser.builder()
                .id(TG_ID)
                .username("DenisMSL")
                .firstName("Denis")
                .build();

        when(hashOperations.get(USER_KEY, "username")).thenReturn(Mono.empty());
        when(hashOperations.putAll(eq(USER_KEY), any())).thenReturn(Mono.just(true));

        StepVerifier.create(repository.save(user))
                .expectNext(true)
                .verifyComplete();

        verify(valueOperations).set(eq(INDEX_KEY), eq(String.valueOf(TG_ID)), eq(USER_TTL));
        verify(redisTemplate).expire(eq(USER_KEY), eq(USER_TTL));
    }

    @Test
    void save_usernameChange_deletesOldIndex() {
        TelegramUser user = TelegramUser.builder()
                .id(TG_ID)
                .username("NewName")
                .firstName("Denis")
                .build();

        when(hashOperations.get(USER_KEY, "username")).thenReturn(Mono.just("DenisMSL"));
        when(hashOperations.putAll(eq(USER_KEY), any())).thenReturn(Mono.just(true));

        StepVerifier.create(repository.save(user))
                .expectNext(true)
                .verifyComplete();

        verify(redisTemplate).delete("username_idx:denismsl");
        verify(valueOperations).set(eq("username_idx:newname"), eq(String.valueOf(TG_ID)), eq(USER_TTL));
    }

    @Test
    void save_blankUsername_doesNotWriteIndex_deletesOld() {
        TelegramUser user = TelegramUser.builder()
                .id(TG_ID)
                .username(null)
                .firstName("Denis")
                .build();

        when(hashOperations.get(USER_KEY, "username")).thenReturn(Mono.just("DenisMSL"));
        when(hashOperations.putAll(eq(USER_KEY), any())).thenReturn(Mono.just(true));

        StepVerifier.create(repository.save(user))
                .expectNext(true)
                .verifyComplete();

        verify(redisTemplate).delete("username_idx:denismsl");
        verify(valueOperations, never()).set(anyString(), anyString(), any(Duration.class));
    }

    @Test
    void delete_removesUserHashAndIndex() {
        when(hashOperations.get(USER_KEY, "username")).thenReturn(Mono.just("DenisMSL"));

        StepVerifier.create(repository.delete(TG_ID))
                .expectNext(1L)
                .verifyComplete();

        verify(redisTemplate).delete(USER_KEY);
        verify(redisTemplate).delete(INDEX_KEY);
    }
}

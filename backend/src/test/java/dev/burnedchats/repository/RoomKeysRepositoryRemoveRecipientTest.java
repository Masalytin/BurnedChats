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
import org.springframework.data.redis.core.ReactiveValueOperations;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("RoomKeysRepository.removeRecipientAllEpochs")
class RoomKeysRepositoryRemoveRecipientTest {

    private static final String ROOM_ID = "room-keys-1";
    private static final String RECIPIENT = "tg:12345";

    @Mock
    private ReactiveRedisTemplate<String, String> redisTemplate;
    @Mock
    private ReactiveHashOperations<String, Object, Object> hashOperations;
    @Mock
    private ReactiveValueOperations<String, String> valueOperations;

    private RoomKeysRepository repository;

    @BeforeEach
    void setUp() {
        when(redisTemplate.opsForHash()).thenReturn(hashOperations);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        repository = new RoomKeysRepository(redisTemplate);
    }

    @Test
    @DisplayName("removes recipient hash field from every epoch 0..current")
    void removesRecipientFromAllEpochs() {
        when(valueOperations.get("room_key_epoch:" + ROOM_ID)).thenReturn(Mono.just("2"));
        when(hashOperations.remove("room_keys:" + ROOM_ID + ":0", RECIPIENT)).thenReturn(Mono.just(1L));
        when(hashOperations.remove("room_keys:" + ROOM_ID + ":1", RECIPIENT)).thenReturn(Mono.just(0L));
        when(hashOperations.remove("room_keys:" + ROOM_ID + ":2", RECIPIENT)).thenReturn(Mono.just(1L));

        StepVerifier.create(repository.removeRecipientAllEpochs(ROOM_ID, RECIPIENT))
                .expectNext(2L)
                .verifyComplete();

        verify(hashOperations).remove("room_keys:" + ROOM_ID + ":0", RECIPIENT);
        verify(hashOperations).remove("room_keys:" + ROOM_ID + ":1", RECIPIENT);
        verify(hashOperations).remove("room_keys:" + ROOM_ID + ":2", RECIPIENT);
    }

    @Test
    @DisplayName("defaults to epoch 0 when counter is missing")
    void defaultsToEpochZeroWhenCounterMissing() {
        when(valueOperations.get("room_key_epoch:" + ROOM_ID)).thenReturn(Mono.empty());
        when(hashOperations.remove(eq("room_keys:" + ROOM_ID + ":0"), eq(RECIPIENT)))
                .thenReturn(Mono.just(1L));

        StepVerifier.create(repository.removeRecipientAllEpochs(ROOM_ID, RECIPIENT))
                .expectNext(1L)
                .verifyComplete();
    }
}

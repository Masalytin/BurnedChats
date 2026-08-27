package dev.burnedchats.repository;

import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.ReactiveHashOperations;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Duration;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("RoomKeyRequestInboxRepository")
class RoomKeyRequestInboxRepositoryTest {

    private static final String OWNER = InternalIds.forTelegramId(1L);
    private static final String REQUESTER = InternalIds.forTelegramId(2L);
    private static final String ROOM = "room-rcatch-03";
    private static final String KEY = "room_key_request_inbox:" + OWNER;
    private static final String FIELD = ROOM + ":" + REQUESTER;
    private static final long REQUESTED_AT = 1_724_000_000_000L;

    @Mock
    private ReactiveRedisTemplate<String, String> redisTemplate;
    @Mock
    private ReactiveHashOperations<String, Object, Object> hashOperations;

    private RoomKeyRequestInboxRepository repository;

    @BeforeEach
    void setUp() {
        when(redisTemplate.opsForHash()).thenReturn(hashOperations);
        repository = new RoomKeyRequestInboxRepository(redisTemplate);
    }

    @Test
    @DisplayName("record writes HASH field {roomId}:{requester} → epoch ms and sets 7-day TTL")
    void record_writesFieldAndSetsSevenDayTtl() {
        when(hashOperations.hasKey(KEY, FIELD)).thenReturn(Mono.just(false));
        when(hashOperations.size(KEY)).thenReturn(Mono.just(0L));
        when(hashOperations.put(eq(KEY), eq(FIELD), eq(String.valueOf(REQUESTED_AT))))
                .thenReturn(Mono.just(true));
        when(redisTemplate.expire(eq(KEY), any(Duration.class))).thenReturn(Mono.just(true));

        StepVerifier.create(repository.record(OWNER, ROOM, REQUESTER, REQUESTED_AT))
                .verifyComplete();

        verify(hashOperations).put(KEY, FIELD, String.valueOf(REQUESTED_AT));
        ArgumentCaptor<Duration> ttl = ArgumentCaptor.forClass(Duration.class);
        verify(redisTemplate).expire(eq(KEY), ttl.capture());
        assertThat(ttl.getValue()).isEqualTo(Duration.ofDays(7));
        verify(hashOperations, never()).remove(anyString(), any());
    }

    @Test
    @DisplayName("same pair overwrites timestamp and does not evict — HASH length does not grow")
    void record_samePairUpdatesTimestampWithoutGrowing() {
        long later = REQUESTED_AT + 12_000L;
        when(hashOperations.hasKey(KEY, FIELD)).thenReturn(Mono.just(true));
        when(hashOperations.put(eq(KEY), eq(FIELD), eq(String.valueOf(later))))
                .thenReturn(Mono.just(true));
        when(redisTemplate.expire(eq(KEY), any(Duration.class))).thenReturn(Mono.just(true));

        StepVerifier.create(repository.record(OWNER, ROOM, REQUESTER, later))
                .verifyComplete();

        verify(hashOperations).put(KEY, FIELD, String.valueOf(later));
        verify(hashOperations, never()).size(KEY);
        verify(hashOperations, never()).remove(anyString(), any());
    }

    @Test
    @DisplayName("new pair at cap evicts the oldest field, not the newest")
    void record_atCapEvictsOldestKeepsNewest() {
        String oldestField = "room-old:" + InternalIds.forTelegramId(9L);
        String newerField = "room-new:" + InternalIds.forTelegramId(8L);
        String incomingRequester = InternalIds.forTelegramId(3L);
        String incomingField = ROOM + ":" + incomingRequester;
        long incomingAt = REQUESTED_AT + 50_000L;

        when(hashOperations.hasKey(KEY, incomingField)).thenReturn(Mono.just(false));
        when(hashOperations.size(KEY)).thenReturn(Mono.just((long) RoomKeyRequestInboxRepository.MAX_FIELDS));
        when(hashOperations.entries(KEY)).thenReturn(Flux.just(
                Map.entry(oldestField, "100"),
                Map.entry(newerField, "200")
        ));
        when(hashOperations.remove(KEY, oldestField)).thenReturn(Mono.just(1L));
        when(hashOperations.put(eq(KEY), eq(incomingField), eq(String.valueOf(incomingAt))))
                .thenReturn(Mono.just(true));
        when(redisTemplate.expire(eq(KEY), any(Duration.class))).thenReturn(Mono.just(true));

        StepVerifier.create(repository.record(OWNER, ROOM, incomingRequester, incomingAt))
                .verifyComplete();

        verify(hashOperations).remove(KEY, oldestField);
        verify(hashOperations, never()).remove(eq(KEY), eq(newerField));
        verify(hashOperations).put(KEY, incomingField, String.valueOf(incomingAt));
    }

    @Test
    @DisplayName("refresh at cap does not evict other fields")
    void record_atCapRefreshDoesNotEvict() {
        when(hashOperations.hasKey(KEY, FIELD)).thenReturn(Mono.just(true));
        when(hashOperations.put(eq(KEY), eq(FIELD), eq(String.valueOf(REQUESTED_AT))))
                .thenReturn(Mono.just(true));
        when(redisTemplate.expire(eq(KEY), any(Duration.class))).thenReturn(Mono.just(true));

        StepVerifier.create(repository.record(OWNER, ROOM, REQUESTER, REQUESTED_AT))
                .verifyComplete();

        verify(hashOperations, never()).size(anyString());
        verify(hashOperations, never()).remove(anyString(), any());
    }

    @Test
    @DisplayName("drain returns parsed facts then deletes the HASH")
    void drain_returnsEntriesAndDeletesKey() {
        when(hashOperations.entries(KEY)).thenReturn(Flux.just(
                Map.entry(FIELD, String.valueOf(REQUESTED_AT))
        ));
        when(redisTemplate.delete(KEY)).thenReturn(Mono.just(1L));

        StepVerifier.create(repository.drain(OWNER))
                .assertNext(pending -> {
                    assertThat(pending.roomId()).isEqualTo(ROOM);
                    assertThat(pending.requesterInternalId()).isEqualTo(REQUESTER);
                    assertThat(pending.requestedAt()).isEqualTo(REQUESTED_AT);
                })
                .verifyComplete();

        verify(redisTemplate).delete(KEY);
    }

    @Test
    @DisplayName("HASH value is epoch millis only — no pubkey, blob, or name")
    void record_valueIsEpochMillisOnly() {
        when(hashOperations.hasKey(KEY, FIELD)).thenReturn(Mono.just(false));
        when(hashOperations.size(KEY)).thenReturn(Mono.just(0L));
        when(hashOperations.put(anyString(), any(), any())).thenReturn(Mono.just(true));
        when(redisTemplate.expire(anyString(), any(Duration.class))).thenReturn(Mono.just(true));

        StepVerifier.create(repository.record(OWNER, ROOM, REQUESTER, REQUESTED_AT))
                .verifyComplete();

        ArgumentCaptor<Object> value = ArgumentCaptor.forClass(Object.class);
        verify(hashOperations).put(eq(KEY), eq(FIELD), value.capture());
        assertThat(value.getValue()).isEqualTo(String.valueOf(REQUESTED_AT));
        assertThat(String.valueOf(value.getValue())).doesNotContain("pubkey", "encrypted", "name");
    }

    @Test
    @DisplayName("blank owner/room/requester is a no-op")
    void record_blankInputsNoOp() {
        StepVerifier.create(repository.record(" ", ROOM, REQUESTER, REQUESTED_AT)).verifyComplete();
        StepVerifier.create(repository.record(OWNER, "", REQUESTER, REQUESTED_AT)).verifyComplete();
        StepVerifier.create(repository.record(OWNER, ROOM, "  ", REQUESTED_AT)).verifyComplete();
        verify(hashOperations, never()).put(anyString(), any(), any());
    }

    @Test
    @DisplayName("drain of blank owner is empty")
    void drain_blankOwnerEmpty() {
        StepVerifier.create(repository.drain(" ")).verifyComplete();
        verify(hashOperations, never()).entries(anyString());
    }
}

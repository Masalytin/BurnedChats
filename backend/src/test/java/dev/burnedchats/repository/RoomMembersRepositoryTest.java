package dev.burnedchats.repository;

import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.ReactiveSetOperations;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Duration;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("RoomMembersRepository")
class RoomMembersRepositoryTest {

    private static final String ROOM_ID = "room-abc-123";
    private static final String MEMBER_INTERNAL = InternalIds.forTelegramId(111111111L);
    private static final String OTHER_MEMBER = InternalIds.forTelegramId(222222222L);
    private static final String FORWARD_KEY = "room_members:" + ROOM_ID;
    private static final String REVERSE_KEY = "member_rooms:" + MEMBER_INTERNAL;

    @Mock
    private ReactiveRedisTemplate<String, String> redisTemplate;

    @Mock
    private ReactiveSetOperations<String, String> setOperations;

    private RoomMembersRepository repository;

    @BeforeEach
    void setUp() {
        when(redisTemplate.opsForSet()).thenReturn(setOperations);
        repository = new RoomMembersRepository(redisTemplate);
    }

    @Nested
    @DisplayName("add")
    class Add {

        @Test
        @DisplayName("should set TTL on forward and reverse keys")
        void shouldSetTtlOnBothKeys() {
            when(setOperations.add(FORWARD_KEY, MEMBER_INTERNAL)).thenReturn(Mono.just(1L));
            when(setOperations.add(REVERSE_KEY, ROOM_ID)).thenReturn(Mono.just(1L));
            when(redisTemplate.expire(eq(FORWARD_KEY), any(Duration.class))).thenReturn(Mono.just(true));
            when(redisTemplate.expire(eq(REVERSE_KEY), any(Duration.class))).thenReturn(Mono.just(true));

            StepVerifier.create(repository.add(ROOM_ID, MEMBER_INTERNAL))
                    .expectNext(1L)
                    .verifyComplete();

            verify(redisTemplate).expire(FORWARD_KEY, RoomMembersRepository.TTL);
            verify(redisTemplate).expire(REVERSE_KEY, RoomMembersRepository.TTL);
        }

        @Test
        @DisplayName("should compensate forward add when reverse index fails")
        void shouldCompensateWhenReverseAddFails() {
            RuntimeException reverseFailure = new RuntimeException("reverse SADD failed");

            when(setOperations.add(FORWARD_KEY, MEMBER_INTERNAL)).thenReturn(Mono.just(1L));
            when(setOperations.add(REVERSE_KEY, ROOM_ID)).thenReturn(Mono.error(reverseFailure));
            when(setOperations.remove(FORWARD_KEY, MEMBER_INTERNAL)).thenReturn(Mono.just(1L));

            StepVerifier.create(repository.add(ROOM_ID, MEMBER_INTERNAL))
                    .expectErrorMatches(e -> e == reverseFailure)
                    .verify();

            verify(setOperations).remove(FORWARD_KEY, MEMBER_INTERNAL);
            verify(redisTemplate, never()).expire(eq(FORWARD_KEY), any(Duration.class));
        }
    }

    @Nested
    @DisplayName("remove")
    class Remove {

        @Test
        @DisplayName("should refresh TTL when member removed")
        void shouldRefreshTtlWhenMemberRemoved() {
            when(setOperations.remove(FORWARD_KEY, MEMBER_INTERNAL)).thenReturn(Mono.just(1L));
            when(setOperations.remove(REVERSE_KEY, (Object) ROOM_ID)).thenReturn(Mono.just(1L));
            when(redisTemplate.expire(eq(FORWARD_KEY), any(Duration.class))).thenReturn(Mono.just(true));
            when(redisTemplate.expire(eq(REVERSE_KEY), any(Duration.class))).thenReturn(Mono.just(true));

            StepVerifier.create(repository.remove(ROOM_ID, MEMBER_INTERNAL))
                    .expectNext(1L)
                    .verifyComplete();

            verify(redisTemplate).expire(FORWARD_KEY, RoomMembersRepository.TTL);
            verify(redisTemplate).expire(REVERSE_KEY, RoomMembersRepository.TTL);
        }

        @Test
        @DisplayName("should complete when reverse remove fails (best-effort)")
        void shouldCompleteWhenReverseRemoveFails() {
            when(setOperations.remove(FORWARD_KEY, MEMBER_INTERNAL)).thenReturn(Mono.just(1L));
            when(setOperations.remove(REVERSE_KEY, (Object) ROOM_ID))
                    .thenReturn(Mono.error(new RuntimeException("reverse SREM failed")));
            when(redisTemplate.expire(eq(FORWARD_KEY), any(Duration.class))).thenReturn(Mono.just(true));
            when(redisTemplate.expire(eq(REVERSE_KEY), any(Duration.class))).thenReturn(Mono.just(true));

            StepVerifier.create(repository.remove(ROOM_ID, MEMBER_INTERNAL))
                    .expectNext(1L)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("extendTtl")
    class ExtendTtl {

        @Test
        @DisplayName("should extend TTL on forward key and all member reverse keys")
        void shouldExtendTtlForRoomAndMembers() {
            when(redisTemplate.expire(FORWARD_KEY, RoomMembersRepository.TTL)).thenReturn(Mono.just(true));
            when(setOperations.members(FORWARD_KEY))
                    .thenReturn(Flux.just(MEMBER_INTERNAL, OTHER_MEMBER));
            when(redisTemplate.expire("member_rooms:" + OTHER_MEMBER, RoomMembersRepository.TTL))
                    .thenReturn(Mono.just(true));
            when(redisTemplate.expire(REVERSE_KEY, RoomMembersRepository.TTL)).thenReturn(Mono.just(true));

            StepVerifier.create(repository.extendTtl(ROOM_ID))
                    .expectNext(true)
                    .verifyComplete();

            verify(redisTemplate).expire(FORWARD_KEY, RoomMembersRepository.TTL);
            verify(redisTemplate).expire(REVERSE_KEY, RoomMembersRepository.TTL);
            verify(redisTemplate).expire("member_rooms:" + OTHER_MEMBER, RoomMembersRepository.TTL);
        }
    }

    @Nested
    @DisplayName("cleanupOrphanReverseEntry")
    class CleanupOrphanReverseEntry {

        @Test
        @DisplayName("should remove stale reverse entry when forward membership absent")
        void shouldRemoveStaleReverseEntry() {
            when(setOperations.isMember(FORWARD_KEY, (Object) MEMBER_INTERNAL)).thenReturn(Mono.just(false));
            when(setOperations.remove(REVERSE_KEY, (Object) ROOM_ID)).thenReturn(Mono.just(1L));

            StepVerifier.create(repository.cleanupOrphanReverseEntry(ROOM_ID, MEMBER_INTERNAL))
                    .expectNext(1L)
                    .verifyComplete();

            verify(setOperations).remove(REVERSE_KEY, (Object) ROOM_ID);
        }

        @Test
        @DisplayName("should not remove reverse entry when membership still present")
        void shouldSkipWhenMembershipPresent() {
            when(setOperations.isMember(FORWARD_KEY, (Object) MEMBER_INTERNAL)).thenReturn(Mono.just(true));

            StepVerifier.create(repository.cleanupOrphanReverseEntry(ROOM_ID, MEMBER_INTERNAL))
                    .expectNext(0L)
                    .verifyComplete();

            verify(setOperations, never()).remove(eq(REVERSE_KEY), eq((Object) ROOM_ID));
        }
    }

    @Nested
    @DisplayName("deleteAll")
    class DeleteAll {

        @Test
        @DisplayName("should delete forward key after clearing reverse indexes")
        void shouldDeleteForwardKeyAfterReverseCleanup() {
            when(setOperations.members(FORWARD_KEY)).thenReturn(Flux.just(MEMBER_INTERNAL));
            when(setOperations.remove(REVERSE_KEY, (Object) ROOM_ID)).thenReturn(Mono.just(1L));
            when(redisTemplate.delete(FORWARD_KEY)).thenReturn(Mono.just(1L));

            StepVerifier.create(repository.deleteAll(ROOM_ID))
                    .verifyComplete();

            verify(redisTemplate).delete(FORWARD_KEY);
        }

        @Test
        @DisplayName("should continue deleteAll when reverse cleanup fails for one member")
        void shouldContinueWhenReverseCleanupFails() {
            when(setOperations.members(FORWARD_KEY)).thenReturn(Flux.just(MEMBER_INTERNAL, OTHER_MEMBER));
            when(setOperations.remove(REVERSE_KEY, (Object) ROOM_ID))
                    .thenReturn(Mono.error(new RuntimeException("partial failure")));
            when(setOperations.remove("member_rooms:" + OTHER_MEMBER, (Object) ROOM_ID))
                    .thenReturn(Mono.just(1L));
            when(redisTemplate.delete(FORWARD_KEY)).thenReturn(Mono.just(1L));

            StepVerifier.create(repository.deleteAll(ROOM_ID))
                    .verifyComplete();

            verify(redisTemplate).delete(FORWARD_KEY);
        }
    }
}

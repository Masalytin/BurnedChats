package dev.burnedchats.service;

import dev.burnedchats.dto.event.BurnSignalEvent;
import dev.burnedchats.dto.event.RoomMemberLeftEvent;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.Room;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.MessageRepository;
import dev.burnedchats.repository.RequestRepository;
import dev.burnedchats.repository.RoomJoinRequestRepository;
import dev.burnedchats.repository.RoomKeysRepository;
import dev.burnedchats.repository.RoomMemberPublicKeyRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomPresenceRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.repository.RoomRolesRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.ReactiveValueOperations;
import org.springframework.data.redis.core.ScanOptions;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("UserBurnService")
class UserBurnServiceTest {

    private static final String USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    private static final Long USER_TG = 42L;
    private static final String PEER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    private static final String SESSION_ID = "sess-1";
    private static final String OWNED_ROOM_ID = "room-owned";
    private static final String MEMBER_ROOM_ID = "room-member";

    @Mock private SessionRepository sessionRepository;
    @Mock private MessageRepository messageRepository;
    @Mock private RequestRepository requestRepository;
    @Mock private FileBurnService fileBurnService;
    @Mock private RoomService roomService;
    @Mock private RoomRepository roomRepository;
    @Mock private RoomMembersRepository roomMembersRepository;
    @Mock private RoomMemberPublicKeyRepository memberPublicKeyRepository;
    @Mock private RoomJoinRequestRepository roomJoinRequestRepository;
    @Mock private RoomKeysRepository roomKeysRepository;
    @Mock private RoomRolesRepository roomRolesRepository;
    @Mock private RoomTopicSubscriptionService roomTopicSubscriptionService;
    @Mock private RoomPresenceRepository roomPresenceRepository;
    @Mock private UserIdentityRepository userIdentityRepository;
    @Mock private ReactiveRedisTemplate<String, String> redisTemplate;
    @Mock private ReactiveValueOperations<String, String> valueOperations;
    @Mock private StompUserMessenger stompUserMessenger;

    private UserBurnService service;

    @BeforeEach
    void setUp() {
        service = new UserBurnService(
                sessionRepository,
                messageRepository,
                requestRepository,
                fileBurnService,
                roomService,
                roomRepository,
                roomMembersRepository,
                memberPublicKeyRepository,
                roomJoinRequestRepository,
                roomKeysRepository,
                roomRolesRepository,
                roomTopicSubscriptionService,
                roomPresenceRepository,
                userIdentityRepository,
                redisTemplate,
                stompUserMessenger);

        lenient().when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        lenient().when(userIdentityRepository.findById(USER_ID)).thenReturn(Mono.just(walletUser()));
        lenient().when(fileBurnService.deleteFilesForContext(anyString())).thenReturn(Mono.empty());
        lenient().when(sessionRepository.updateStatus(anyString(), eq(SessionStatus.BURNED))).thenReturn(Mono.just(true));
        lenient().when(messageRepository.deleteAllForSession(anyString(), any())).thenReturn(Mono.just(0L));
        lenient().when(requestRepository.delete(anyString(), anyString())).thenReturn(Mono.just(false));
        lenient().when(sessionRepository.delete(anyString())).thenReturn(Mono.just(1L));
        lenient().when(requestRepository.deleteAll(USER_ID)).thenReturn(Mono.just(1L));
        lenient().when(messageRepository.findSessionsWithPendingMessages(USER_ID)).thenReturn(Flux.empty());
        lenient().when(messageRepository.findSessionsWithPendingEdits(USER_ID)).thenReturn(Flux.empty());
        lenient().when(messageRepository.findSessionsWithPendingDeletions(USER_ID)).thenReturn(Flux.empty());
        lenient().when(roomMembersRepository.getRoomsForMember(USER_ID)).thenReturn(Flux.empty());
        lenient().when(sessionRepository.findAllActiveByParticipant(USER_ID)).thenReturn(Flux.empty());
    }

    private static UnifiedUser walletUser() {
        return new UnifiedUser(USER_ID, AuthType.WALLET, "User", USER_TG, "eqtestwallet", null);
    }

    private static Session activeSession() {
        return Session.builder()
                .id(SESSION_ID)
                .initiatorInternalId(USER_ID)
                .responderInternalId(PEER_ID)
                .initiatorTelegramId(USER_TG)
                .responderTelegramId(99L)
                .status(SessionStatus.ACTIVE)
                .createdAt(Instant.now())
                .build();
    }

    @Nested
    @DisplayName("burnAllForUser full cascade")
    class FullCascade {

        @Test
        @DisplayName("burns DM sessions and signals both peers")
        void burnsDmSessionsAndSignalsPeers() {
            when(sessionRepository.findAllActiveByParticipant(USER_ID))
                    .thenReturn(Flux.just(activeSession()));

            StepVerifier.create(service.burnAllForUser(USER_ID, false))
                    .assertNext(summary -> assertThat(summary.burnedSessions()).isEqualTo(1))
                    .verifyComplete();

            verify(sessionRepository).updateStatus(SESSION_ID, SessionStatus.BURNED);
            verify(fileBurnService).deleteFilesForContext(SESSION_ID);
            verify(sessionRepository).delete(SESSION_ID);

            ArgumentCaptor<BurnSignalEvent> eventCaptor = ArgumentCaptor.forClass(BurnSignalEvent.class);
            verify(stompUserMessenger, times(2)).convertAndSendToInternalId(
                    anyString(), eq("/queue/burn-signal"), eventCaptor.capture());
            assertThat(eventCaptor.getAllValues())
                    .allMatch(BurnSignalEvent::isSuccess)
                    .allMatch(e -> SESSION_ID.equals(e.getSessionId()));
        }

        @Test
        @DisplayName("burns owned rooms and notifies members")
        void burnsOwnedRooms() {
            Room ownedRoom = Room.builder()
                    .id(OWNED_ROOM_ID)
                    .ownerInternalId(USER_ID)
                    .ownerTgId(USER_TG)
                    .build();
            when(roomMembersRepository.getRoomsForMember(USER_ID))
                    .thenReturn(Flux.just(OWNED_ROOM_ID));
            when(roomRepository.findById(OWNED_ROOM_ID)).thenReturn(Mono.just(ownedRoom));
            when(roomService.isOwner(ownedRoom, USER_ID)).thenReturn(true);
            when(roomService.burnRoomAsOwner(OWNED_ROOM_ID, USER_ID))
                    .thenReturn(Mono.just(List.of(PEER_ID)));
            when(roomPresenceRepository.deleteAll(OWNED_ROOM_ID)).thenReturn(Mono.empty());
            when(roomService.notifyRoomBurned(eq(OWNED_ROOM_ID), eq(USER_TG), any()))
                    .thenReturn(Mono.empty());

            StepVerifier.create(service.burnAllForUser(USER_ID, false))
                    .assertNext(summary -> assertThat(summary.burnedRooms()).isEqualTo(1))
                    .verifyComplete();

            verify(roomService).burnRoomAsOwner(OWNED_ROOM_ID, USER_ID);
            verify(roomService).notifyRoomBurned(eq(OWNED_ROOM_ID), eq(USER_TG), any());
        }

        @Test
        @DisplayName("leaves member rooms and emits room-member-left")
        void leavesMemberRooms() {
            Room memberRoom = Room.builder()
                    .id(MEMBER_ROOM_ID)
                    .ownerInternalId(PEER_ID)
                    .ownerTgId(99L)
                    .build();
            when(roomMembersRepository.getRoomsForMember(USER_ID))
                    .thenReturn(Flux.just(MEMBER_ROOM_ID));
            when(roomRepository.findById(MEMBER_ROOM_ID)).thenReturn(Mono.just(memberRoom));
            when(roomService.isOwner(memberRoom, USER_ID)).thenReturn(false);
            when(roomMembersRepository.isMember(MEMBER_ROOM_ID, USER_ID)).thenReturn(Mono.just(true));
            when(roomMembersRepository.remove(MEMBER_ROOM_ID, USER_ID)).thenReturn(Mono.just(1L));
            when(memberPublicKeyRepository.remove(MEMBER_ROOM_ID, USER_ID)).thenReturn(Mono.empty());
            when(roomJoinRequestRepository.remove(MEMBER_ROOM_ID, USER_ID)).thenReturn(Mono.empty());
            when(roomKeysRepository.removeRecipientAllEpochs(MEMBER_ROOM_ID, USER_ID)).thenReturn(Mono.just(1L));
            when(roomRolesRepository.remove(MEMBER_ROOM_ID, USER_ID)).thenReturn(Mono.just(1L));
            when(roomMembersRepository.getMembers(MEMBER_ROOM_ID)).thenReturn(Flux.just(PEER_ID));

            StepVerifier.create(service.burnAllForUser(USER_ID, false))
                    .assertNext(summary -> assertThat(summary.leftRooms()).isEqualTo(1))
                    .verifyComplete();

            verify(roomTopicSubscriptionService).unsubscribeUserFromRoomTopic(MEMBER_ROOM_ID, USER_ID);
            verify(stompUserMessenger).convertAndSendToInternalId(
                    eq(PEER_ID), eq("/queue/room-member-left"), any(RoomMemberLeftEvent.class));
        }
    }

    @Nested
    @DisplayName("wipeIdentity")
    class WipeIdentity {

        @Test
        @DisplayName("wipeIdentity=true deletes profile and auth bindings")
        void wipeIdentityTrue() {
            when(redisTemplate.delete(anyString())).thenReturn(Mono.just(1L));
            when(redisTemplate.scan(any(ScanOptions.class))).thenReturn(Flux.empty());
            when(userIdentityRepository.normalizeWallet("eqtestwallet")).thenReturn("eqtestwallet");

            StepVerifier.create(service.burnAllForUser(USER_ID, true))
                    .assertNext(summary -> assertThat(summary.wipeIdentity()).isTrue())
                    .verifyComplete();

            verify(redisTemplate).delete("user:" + USER_ID);
            verify(redisTemplate).delete("auth_tg:" + USER_TG);
            verify(redisTemplate).delete("auth_wallet:eqtestwallet");
            verify(redisTemplate).delete("lang:pref:" + USER_ID);
            verify(redisTemplate).delete("member_rooms:" + USER_ID);
        }

        @Test
        @DisplayName("wipeIdentity=false preserves profile")
        void wipeIdentityFalse() {
            StepVerifier.create(service.burnAllForUser(USER_ID, false))
                    .assertNext(summary -> assertThat(summary.wipeIdentity()).isFalse())
                    .verifyComplete();

            verify(redisTemplate, never()).delete("user:" + USER_ID);
            verify(redisTemplate, never()).delete("auth_tg:" + USER_TG);
        }
    }

    @Nested
    @DisplayName("idempotency")
    class Idempotency {

        @Test
        @DisplayName("empty account completes without error")
        void emptyAccountSucceeds() {
            StepVerifier.create(service.burnAllForUser(USER_ID, false))
                    .assertNext(summary -> {
                        assertThat(summary.burnedSessions()).isZero();
                        assertThat(summary.burnedRooms()).isZero();
                        assertThat(summary.leftRooms()).isZero();
                    })
                    .verifyComplete();
        }
    }
}

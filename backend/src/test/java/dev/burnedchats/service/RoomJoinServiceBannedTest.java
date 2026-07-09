package dev.burnedchats.service;

import dev.burnedchats.model.InviteToken;
import dev.burnedchats.model.Room;
import dev.burnedchats.repository.InviteTokenRepository;
import dev.burnedchats.repository.RoomBansRepository;
import dev.burnedchats.repository.RoomJoinRequestRepository;
import dev.burnedchats.repository.RoomMemberPublicKeyRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("RoomJoinService ban enforcement")
class RoomJoinServiceBannedTest {

    private static final String ROOM_ID = "room-uuid-1";
    private static final String TOKEN = "abc123token";
    private static final String SENDER_INTERNAL = "sender-internal-id";
    private static final String OWNER_INTERNAL = "owner-internal-id";

    @Mock
    private RoomRepository roomRepository;

    @Mock
    private RoomMembersRepository roomMembersRepository;

    @Mock
    private RoomJoinRequestRepository joinRequestRepository;

    @Mock
    private InviteTokenRepository inviteTokenRepository;

    @Mock
    private InviteTokenService inviteTokenService;

    @Mock
    private PasswordProofService passwordProofService;

    @Mock
    private RoomMemberPublicKeyRepository memberPublicKeyRepository;

    @Mock
    private RoomBansRepository roomBansRepository;

    @Mock
    private RateLimitService rateLimitService;

    @InjectMocks
    private RoomJoinService roomJoinService;

    private InviteToken validToken;
    private Room room;

    @BeforeEach
    void setUp() {
        validToken = InviteToken.builder()
                .token(TOKEN)
                .roomId(ROOM_ID)
                .expiresAt(System.currentTimeMillis() + 60_000L)
                .build();
        room = Room.builder()
                .id(ROOM_ID)
                .ownerInternalId(OWNER_INTERNAL)
                .joinMode(Room.JoinMode.BY_REQUEST)
                .build();
    }

    @Test
    @DisplayName("requestJoin should reject banned user with USER_BANNED")
    void shouldRejectBannedUserOnRequestJoin() {
        when(inviteTokenRepository.findByToken(TOKEN)).thenReturn(Mono.just(validToken));
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(room));
        when(roomMembersRepository.isMember(ROOM_ID, SENDER_INTERNAL)).thenReturn(Mono.just(false));
        when(roomBansRepository.isBanned(ROOM_ID, SENDER_INTERNAL)).thenReturn(Mono.just(true));

        StepVerifier.create(roomJoinService.requestJoin(
                        SENDER_INTERNAL,
                        111L,
                        "user",
                        "User",
                        TOKEN,
                        null,
                        "pubkey"))
                .expectErrorMatches(error -> error instanceof IllegalArgumentException
                        && "USER_BANNED".equals(error.getMessage()))
                .verify();

        verify(joinRequestRepository, never()).save(any());
        verify(inviteTokenService, never()).consumeInviteUse(any());
    }

    @Test
    @DisplayName("acceptJoin should reject banned user with USER_BANNED")
    void shouldRejectBannedUserOnAcceptJoin() {
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(room));
        when(roomBansRepository.isBanned(ROOM_ID, SENDER_INTERNAL)).thenReturn(Mono.just(true));
        when(joinRequestRepository.findByRoomAndSender(ROOM_ID, SENDER_INTERNAL)).thenReturn(Mono.empty());

        StepVerifier.create(roomJoinService.acceptJoin(OWNER_INTERNAL, ROOM_ID, SENDER_INTERNAL))
                .expectErrorMatches(error -> error instanceof IllegalArgumentException
                        && "USER_BANNED".equals(error.getMessage()))
                .verify();

        verify(roomMembersRepository, never()).add(any(String.class), any(String.class));
    }
}

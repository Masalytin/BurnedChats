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
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("RoomJoinService invite limits")
class RoomJoinServiceInviteLimitTest {

    private static final String ROOM_ID = "room-uuid-1";
    private static final String TOKEN = "abc123token";
    private static final String SENDER_INTERNAL = "sender-internal-id";

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

    private InviteToken exhaustedToken;
    private Room room;

    @BeforeEach
    void setUp() {
        exhaustedToken = InviteToken.builder()
                .token(TOKEN)
                .roomId(ROOM_ID)
                .expiresAt(System.currentTimeMillis() + 60_000L)
                .maxUses(2)
                .usedCount(2)
                .build();
        room = Room.builder()
                .id(ROOM_ID)
                .joinMode(Room.JoinMode.BY_REQUEST)
                .build();
    }

    @Test
    @DisplayName("should return INVITE_EXHAUSTED and delete token when limit reached")
    void shouldRejectExhaustedInvite() {
        when(inviteTokenRepository.findByToken(TOKEN)).thenReturn(Mono.just(exhaustedToken));
        when(inviteTokenRepository.deleteTokenAndIndex(TOKEN, ROOM_ID)).thenReturn(Mono.empty());

        StepVerifier.create(roomJoinService.requestJoin(
                        SENDER_INTERNAL,
                        111L,
                        "user",
                        "User",
                        TOKEN,
                        null,
                        "pubkey"))
                .expectErrorMatches(error -> error instanceof IllegalArgumentException
                        && "INVITE_EXHAUSTED".equals(error.getMessage()))
                .verify();

        verify(inviteTokenRepository).deleteTokenAndIndex(TOKEN, ROOM_ID);
        verify(roomRepository, never()).findById(any());
    }

    @Test
    @DisplayName("should consume invite use after successful BY_PASSWORD join")
    void shouldConsumeInviteAfterDirectJoin() {
        InviteToken limitedToken = InviteToken.builder()
                .token(TOKEN)
                .roomId(ROOM_ID)
                .expiresAt(System.currentTimeMillis() + 60_000L)
                .maxUses(1)
                .usedCount(0)
                .build();
        Room passwordRoom = Room.builder()
                .id(ROOM_ID)
                .joinMode(Room.JoinMode.BY_PASSWORD)
                .passwordProofHash("hash")
                .build();

        when(inviteTokenRepository.findByToken(TOKEN)).thenReturn(Mono.just(limitedToken));
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(passwordRoom));
        when(rateLimitService.checkRateLimit(eq(ROOM_ID + ":" + SENDER_INTERNAL),
                eq(RateLimitService.RateLimitType.ROOM_PASSWORD_FAIL)))
                .thenReturn(Mono.just(true));
        when(rateLimitService.resetRateLimit(eq(ROOM_ID + ":" + SENDER_INTERNAL),
                eq(RateLimitService.RateLimitType.ROOM_PASSWORD_FAIL)))
                .thenReturn(Mono.just(true));
        when(passwordProofService.verifyProof("proof", "hash")).thenReturn(true);
        when(roomMembersRepository.isMember(ROOM_ID, SENDER_INTERNAL)).thenReturn(Mono.just(false));
        when(roomBansRepository.isBanned(ROOM_ID, SENDER_INTERNAL)).thenReturn(Mono.just(false));
        when(roomMembersRepository.add(ROOM_ID, SENDER_INTERNAL)).thenReturn(Mono.just(1L));
        when(memberPublicKeyRepository.put(ROOM_ID, SENDER_INTERNAL, "pubkey")).thenReturn(Mono.empty());
        when(roomRepository.extendTtl(ROOM_ID, RoomRepository.DEFAULT_TTL)).thenReturn(Mono.just(true));
        when(roomBansRepository.extendTtl(ROOM_ID)).thenReturn(Mono.just(true));
        when(inviteTokenService.consumeInviteUse(TOKEN)).thenReturn(Mono.empty());

        StepVerifier.create(roomJoinService.requestJoin(
                        SENDER_INTERNAL,
                        111L,
                        "user",
                        "User",
                        TOKEN,
                        "proof",
                        "pubkey"))
                .expectNextMatches(result -> result instanceof RoomJoinService.JoinResult.Approved)
                .verifyComplete();

        verify(inviteTokenService).consumeInviteUse(TOKEN);
    }
}

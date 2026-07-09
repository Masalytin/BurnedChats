package dev.burnedchats.service;

import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.model.InviteToken;
import dev.burnedchats.model.Room;
import dev.burnedchats.repository.InviteTokenRepository;
import dev.burnedchats.repository.RoomBansRepository;
import dev.burnedchats.repository.RoomJoinRequestRepository;
import dev.burnedchats.repository.RoomMemberPublicKeyRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.service.RateLimitService.RateLimitType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * SEC-8 / IMP-FAUDIT2-F01: room-password fail budget is gated by atomic INCR+EXPIRE
 * before verifyProof; successes reset the counter.
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("RoomJoinService password-proof rate limit")
class RoomJoinPasswordRateLimitTest {

    private static final String ROOM_ID = "room-uuid-pw";
    private static final String TOKEN = "invite-token-pw";
    private static final String SENDER_INTERNAL = "sender-internal-id";
    private static final String OWNER_INTERNAL = "owner-internal-id";
    private static final String STORED_HASH = "stored-proof-hash";
    private static final String WRONG_PROOF = "wrong-proof-base64";
    private static final String CORRECT_PROOF = "correct-proof-base64";
    private static final String PUBLIC_KEY = "sender-pubkey";
    private static final String RATE_KEY = ROOM_ID + ":" + SENDER_INTERNAL;
    private static final int MAX_FAILURES = 5;

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

    private RoomJoinService roomJoinService;

    private InviteToken validToken;
    private Room passwordRoom;

    @BeforeEach
    void setUp() {
        roomJoinService = new RoomJoinService(
                roomRepository,
                roomMembersRepository,
                joinRequestRepository,
                inviteTokenRepository,
                inviteTokenService,
                passwordProofService,
                memberPublicKeyRepository,
                roomBansRepository,
                rateLimitService);

        validToken = InviteToken.builder()
                .token(TOKEN)
                .roomId(ROOM_ID)
                .expiresAt(System.currentTimeMillis() + 60_000L)
                .build();
        passwordRoom = Room.builder()
                .id(ROOM_ID)
                .ownerInternalId(OWNER_INTERNAL)
                .joinMode(Room.JoinMode.BY_PASSWORD)
                .passwordProofHash(STORED_HASH)
                .build();
    }

    @Test
    @DisplayName("failed proof increments ROOM_PASSWORD_FAIL and returns WRONG_PASSWORD")
    void failedProofIncrementsCounterAndReturnsWrongPassword() {
        stubInviteAndRoom();
        when(rateLimitService.checkRateLimit(RATE_KEY, RateLimitType.ROOM_PASSWORD_FAIL))
                .thenReturn(Mono.just(true));
        when(passwordProofService.verifyProof(WRONG_PROOF, STORED_HASH)).thenReturn(false);

        StepVerifier.create(requestJoin(WRONG_PROOF))
                .expectErrorMatches(error -> error instanceof SecurityException
                        && "WRONG_PASSWORD".equals(error.getMessage()))
                .verify();

        verify(rateLimitService).checkRateLimit(RATE_KEY, RateLimitType.ROOM_PASSWORD_FAIL);
        verify(rateLimitService, never()).getRemainingRequests(anyString(), eq(RateLimitType.ROOM_PASSWORD_FAIL));
        verify(rateLimitService, never()).resetRateLimit(anyString(), eq(RateLimitType.ROOM_PASSWORD_FAIL));
        verify(roomMembersRepository, never()).add(anyString(), anyString());
    }

    @Test
    @DisplayName("after N failed proofs the next attempt is rejected with RateLimitException")
    void afterMaxFailuresNextAttemptIsRateLimited() {
        stubInviteAndRoom();
        when(rateLimitService.checkRateLimit(RATE_KEY, RateLimitType.ROOM_PASSWORD_FAIL))
                .thenReturn(Mono.error(new RateLimitException(RateLimitType.ROOM_PASSWORD_FAIL.getWindow())));

        StepVerifier.create(requestJoin(WRONG_PROOF))
                .expectError(RateLimitException.class)
                .verify();

        verify(passwordProofService, never()).verifyProof(anyString(), anyString());
        verify(rateLimitService).checkRateLimit(RATE_KEY, RateLimitType.ROOM_PASSWORD_FAIL);
        verify(rateLimitService, never()).getRemainingRequests(anyString(), eq(RateLimitType.ROOM_PASSWORD_FAIL));
        verify(roomMembersRepository, never()).add(anyString(), anyString());
    }

    @Test
    @DisplayName("successful proof within limit joins and resets fail counter")
    void successfulProofWithinLimitResetsFailCounter() {
        stubInviteAndRoom();
        when(rateLimitService.checkRateLimit(RATE_KEY, RateLimitType.ROOM_PASSWORD_FAIL))
                .thenReturn(Mono.just(true));
        when(passwordProofService.verifyProof(CORRECT_PROOF, STORED_HASH)).thenReturn(true);
        when(rateLimitService.resetRateLimit(RATE_KEY, RateLimitType.ROOM_PASSWORD_FAIL))
                .thenReturn(Mono.just(true));
        when(roomMembersRepository.isMember(ROOM_ID, SENDER_INTERNAL)).thenReturn(Mono.just(false));
        when(roomBansRepository.isBanned(ROOM_ID, SENDER_INTERNAL)).thenReturn(Mono.just(false));
        when(roomMembersRepository.add(ROOM_ID, SENDER_INTERNAL)).thenReturn(Mono.just(1L));
        when(memberPublicKeyRepository.put(ROOM_ID, SENDER_INTERNAL, PUBLIC_KEY)).thenReturn(Mono.empty());
        when(roomRepository.extendTtl(ROOM_ID, RoomRepository.DEFAULT_TTL)).thenReturn(Mono.just(true));
        when(roomBansRepository.extendTtl(ROOM_ID)).thenReturn(Mono.just(true));
        when(inviteTokenService.consumeInviteUse(TOKEN)).thenReturn(Mono.empty());

        StepVerifier.create(requestJoin(CORRECT_PROOF))
                .expectNextMatches(result -> result instanceof RoomJoinService.JoinResult.Approved)
                .verifyComplete();

        verify(rateLimitService).checkRateLimit(RATE_KEY, RateLimitType.ROOM_PASSWORD_FAIL);
        verify(rateLimitService).resetRateLimit(RATE_KEY, RateLimitType.ROOM_PASSWORD_FAIL);
        verify(rateLimitService, never()).getRemainingRequests(anyString(), eq(RateLimitType.ROOM_PASSWORD_FAIL));
        verify(roomMembersRepository).add(ROOM_ID, SENDER_INTERNAL);
    }

    @Test
    @DisplayName("lockout blocks even a correct proof when fail budget is exhausted")
    void lockoutBlocksCorrectProof() {
        stubInviteAndRoom();
        when(rateLimitService.checkRateLimit(RATE_KEY, RateLimitType.ROOM_PASSWORD_FAIL))
                .thenReturn(Mono.error(new RateLimitException(RateLimitType.ROOM_PASSWORD_FAIL.getWindow())));

        StepVerifier.create(requestJoin(CORRECT_PROOF))
                .expectError(RateLimitException.class)
                .verify();

        verify(passwordProofService, never()).verifyProof(anyString(), anyString());
        verify(rateLimitService, never()).resetRateLimit(anyString(), eq(RateLimitType.ROOM_PASSWORD_FAIL));
        verify(roomMembersRepository, never()).add(anyString(), anyString());
    }

    /**
     * W2-1 / IMP-FAUDIT2-F01: concurrent wrong proofs must not exceed the fail budget of
     * verifyProof calls. Atomic checkRateLimit (INCR+EXPIRE) is the sole gate — no GET
     * pre-check — so a parallel burst of N attempts yields at most MAX_FAILURES verifies.
     */
    @Test
    @DisplayName("concurrent wrong proofs reach verifyProof at most MAX_FAILURES times")
    void concurrentWrongProofsDoNotExceedVerifyProofBudget() {
        stubInviteAndRoom();

        AtomicInteger failCount = new AtomicInteger();
        AtomicInteger verifyProofCalls = new AtomicInteger();
        int concurrency = MAX_FAILURES * 4;

        // Atomic increment-first gate: only checkRateLimit participates; GET pre-check is gone.
        when(rateLimitService.checkRateLimit(RATE_KEY, RateLimitType.ROOM_PASSWORD_FAIL))
                .thenAnswer(invocation -> {
                    int count = failCount.incrementAndGet();
                    if (count > MAX_FAILURES) {
                        return Mono.error(new RateLimitException(
                                RateLimitType.ROOM_PASSWORD_FAIL.getWindow()));
                    }
                    return Mono.just(true);
                });
        when(passwordProofService.verifyProof(WRONG_PROOF, STORED_HASH)).thenAnswer(invocation -> {
            verifyProofCalls.incrementAndGet();
            return false;
        });

        StepVerifier.create(
                        Flux.range(0, concurrency)
                                .flatMap(i -> requestJoin(WRONG_PROOF)
                                        .map(result -> "ok")
                                        .onErrorResume(error -> Mono.just("err")), concurrency)
                                .then())
                .verifyComplete();

        assertTrue(
                verifyProofCalls.get() <= MAX_FAILURES,
                "verifyProof must be called at most " + MAX_FAILURES
                        + " times under concurrent wrong proofs, but was "
                        + verifyProofCalls.get());
        verify(rateLimitService, never()).getRemainingRequests(anyString(), eq(RateLimitType.ROOM_PASSWORD_FAIL));
        verify(rateLimitService, times(concurrency))
                .checkRateLimit(RATE_KEY, RateLimitType.ROOM_PASSWORD_FAIL);
    }

    private void stubInviteAndRoom() {
        when(inviteTokenRepository.findByToken(TOKEN)).thenReturn(Mono.just(validToken));
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(passwordRoom));
    }

    private Mono<RoomJoinService.JoinResult> requestJoin(String passwordProof) {
        return roomJoinService.requestJoin(
                SENDER_INTERNAL,
                111L,
                "user",
                "User",
                TOKEN,
                passwordProof,
                PUBLIC_KEY);
    }
}

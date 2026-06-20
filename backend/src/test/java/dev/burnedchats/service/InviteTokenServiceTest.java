package dev.burnedchats.service;

import dev.burnedchats.config.TelegramProperties;
import dev.burnedchats.model.InviteToken;
import dev.burnedchats.model.Room;
import dev.burnedchats.repository.InviteTokenRepository;
import dev.burnedchats.repository.RoomRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("InviteTokenService")
class InviteTokenServiceTest {

    private static final String ROOM_ID = "room-uuid-1";
    private static final String TOKEN = "abc123token";
    private static final String OWNER_INTERNAL = "owner-internal-id";

    @Mock
    private InviteTokenRepository inviteTokenRepository;

    @Mock
    private RoomRepository roomRepository;

    @Mock
    private TelegramProperties telegramProperties;

    @InjectMocks
    private InviteTokenService inviteTokenService;

    @Nested
    @DisplayName("revokeInvite")
    class RevokeInvite {

        @Test
        @DisplayName("should delete token when requester is owner")
        void shouldDeleteTokenForOwner() {
            Room room = Room.builder()
                    .id(ROOM_ID)
                    .ownerInternalId(OWNER_INTERNAL)
                    .build();
            InviteToken inviteToken = InviteToken.builder()
                    .token(TOKEN)
                    .roomId(ROOM_ID)
                    .usedCount(0)
                    .build();

            when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(room));
            when(inviteTokenRepository.findByToken(TOKEN)).thenReturn(Mono.just(inviteToken));
            when(inviteTokenRepository.deleteTokenAndIndex(TOKEN, ROOM_ID)).thenReturn(Mono.empty());

            StepVerifier.create(inviteTokenService.revokeInvite(ROOM_ID, TOKEN, OWNER_INTERNAL))
                    .verifyComplete();

            verify(inviteTokenRepository).deleteTokenAndIndex(TOKEN, ROOM_ID);
        }

        @Test
        @DisplayName("should reject when requester is not owner")
        void shouldRejectNonOwner() {
            Room room = Room.builder()
                    .id(ROOM_ID)
                    .ownerInternalId(OWNER_INTERNAL)
                    .build();

            when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(room));

            StepVerifier.create(inviteTokenService.revokeInvite(ROOM_ID, TOKEN, "other-user"))
                    .expectError(SecurityException.class)
                    .verify();

            verify(inviteTokenRepository, never()).deleteTokenAndIndex(eq(TOKEN), eq(ROOM_ID));
        }
    }

    @Nested
    @DisplayName("consumeInviteUse")
    class ConsumeInviteUse {

        @Test
        @DisplayName("should delete token when maxUses is reached")
        void shouldDeleteWhenMaxUsesReached() {
            InviteToken inviteToken = InviteToken.builder()
                    .token(TOKEN)
                    .roomId(ROOM_ID)
                    .maxUses(1)
                    .usedCount(0)
                    .build();

            when(inviteTokenRepository.findByToken(TOKEN)).thenReturn(Mono.just(inviteToken));
            when(inviteTokenRepository.incrementUseCount(TOKEN)).thenReturn(Mono.just(1L));
            when(inviteTokenRepository.deleteTokenAndIndex(TOKEN, ROOM_ID)).thenReturn(Mono.empty());

            StepVerifier.create(inviteTokenService.consumeInviteUse(TOKEN))
                    .verifyComplete();

            verify(inviteTokenRepository).incrementUseCount(TOKEN);
            verify(inviteTokenRepository).deleteTokenAndIndex(TOKEN, ROOM_ID);
        }

        @Test
        @DisplayName("should not increment when token is unlimited")
        void shouldSkipIncrementForUnlimitedToken() {
            InviteToken inviteToken = InviteToken.builder()
                    .token(TOKEN)
                    .roomId(ROOM_ID)
                    .maxUses(null)
                    .usedCount(0)
                    .build();

            when(inviteTokenRepository.findByToken(TOKEN)).thenReturn(Mono.just(inviteToken));

            StepVerifier.create(inviteTokenService.consumeInviteUse(TOKEN))
                    .verifyComplete();

            verify(inviteTokenRepository, never()).incrementUseCount(TOKEN);
            verify(inviteTokenRepository, never()).deleteTokenAndIndex(eq(TOKEN), eq(ROOM_ID));
        }
    }
}

package dev.burnedchats.service;

import dev.burnedchats.config.TelegramProperties;
import dev.burnedchats.model.InviteToken;
import dev.burnedchats.model.Room;
import dev.burnedchats.repository.InviteTokenRepository;
import dev.burnedchats.repository.RoomRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;

/**
 * Business logic for invite token lifecycle: generation and retrieval.
 *
 * <p>Invite tokens are cryptographically random 32-byte hex strings that allow
 * users to join a room via a Telegram deep link. A room may have multiple active tokens.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InviteTokenService {

    private static final int TOKEN_BYTES = 32;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final InviteTokenRepository inviteTokenRepository;
    private final RoomRepository roomRepository;
    private final TelegramProperties telegramProperties;

    /**
     * Generate a new invite token for the given room, only if the requester is the owner.
     *
     * @param roomId      the room UUID
     * @param requesterTgId Telegram ID of the user requesting the link (must be owner)
     * @return Mono with the invite URL, or error if not owner / room not found
     */
    public Mono<String> generateInviteLink(String roomId, Long requesterTgId) {
        return roomRepository.findById(roomId)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> {
                    if (!java.util.Objects.equals(room.getOwnerTgId(), requesterTgId)) {
                        return Mono.error(new SecurityException("NOT_OWNER"));
                    }

                    String tokenValue = generateSecureToken();
                    long expiresAt = Instant.now()
                            .plus(InviteToken.DEFAULT_TTL_DAYS, ChronoUnit.DAYS)
                            .toEpochMilli();

                    InviteToken token = InviteToken.builder()
                            .token(tokenValue)
                            .roomId(roomId)
                            .createdBy(requesterTgId)
                            .expiresAt(expiresAt)
                            .usedCount(0)
                            .build();

                    return inviteTokenRepository.save(token)
                            .thenReturn(buildInviteUrl(tokenValue));
                })
                .doOnSuccess(url -> LOG.info("Invite link generated for room={} by tgId={}", roomId, requesterTgId))
                .doOnError(e -> LOG.warn("Failed to generate invite link for room={}: {}", roomId, e.getMessage()));
    }

    /**
     * Build the Telegram Mini App deep link for the given token.
     *
     * <p>Format: {@code https://t.me/{botUsername}/app?startapp=invite_{token}}
     */
    public String buildInviteUrl(String tokenValue) {
        String botUsername = telegramProperties.getBot().getUsername();
        return "https://t.me/" + botUsername + "/app?startapp=invite_" + tokenValue;
    }

    /**
     * Resolve a room by its invite token.
     *
     * <p>Used by clients that need the room's KDF salt and join mode before
     * deriving their password proof.
     *
     * @param inviteToken the invite token from the deep link
     * @return Mono with the {@link Room}, or error for INVALID_TOKEN / ROOM_NOT_FOUND
     */
    public Mono<Room> resolveRoomByToken(String inviteToken) {
        return inviteTokenRepository.findByToken(inviteToken)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("INVALID_TOKEN")))
                .flatMap(token -> roomRepository.findById(token.getRoomId())
                        .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND"))));
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private String generateSecureToken() {
        byte[] bytes = new byte[TOKEN_BYTES];
        SECURE_RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }
}

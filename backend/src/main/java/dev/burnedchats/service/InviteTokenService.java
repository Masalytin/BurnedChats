package dev.burnedchats.service;

import dev.burnedchats.config.TelegramProperties;
import dev.burnedchats.dto.event.RoomInvitesEvent;
import dev.burnedchats.model.InviteToken;
import dev.burnedchats.model.Room;
import dev.burnedchats.repository.InviteTokenRepository;
import dev.burnedchats.repository.InviteTokenRepository.StoredInviteToken;
import dev.burnedchats.repository.RoomRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.lang.Nullable;
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
    private static final long MIN_EXPIRES_SECONDS = 60L;
    private static final long MAX_EXPIRES_SECONDS = ChronoUnit.DAYS.getDuration().multipliedBy(30).getSeconds();
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final InviteTokenRepository inviteTokenRepository;
    private final RoomRepository roomRepository;
    private final TelegramProperties telegramProperties;

    /**
     * Generate a new invite token for the given room, only if the requester is the owner.
     *
     * @param roomId               the room UUID
     * @param requesterInternalId  internal id of the user requesting the link (must be owner)
     * @return Mono with the invite URL, or error if not owner / room not found
     */
    public Mono<String> generateInviteLink(String roomId, String requesterInternalId) {
        return generateInviteLink(roomId, requesterInternalId, null, null);
    }

    /**
     * Generate a new invite token with optional lifetime and use limit.
     *
     * @param roomId               the room UUID
     * @param requesterInternalId  internal id of the user requesting the link (must be owner)
     * @param expiresInSeconds     optional TTL from now; defaults to {@link InviteToken#DEFAULT_TTL_DAYS} days
     * @param maxUses              optional use cap; {@code null} or {@code <= 0} means unlimited
     */
    public Mono<String> generateInviteLink(String roomId,
                                           String requesterInternalId,
                                           @Nullable Long expiresInSeconds,
                                           @Nullable Integer maxUses) {
        return roomRepository.findById(roomId)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> {
                    if (room.getOwnerInternalId() == null
                            || !room.getOwnerInternalId().equals(requesterInternalId)) {
                        return Mono.error(new SecurityException("NOT_OWNER"));
                    }
                    return saveInviteToken(roomId, room.getOwnerTgId(), expiresInSeconds, maxUses);
                })
                .doOnSuccess(url -> LOG.info("Invite link generated for room={} by internalId={}",
                        roomId, requesterInternalId))
                .doOnError(e -> LOG.warn("Failed to generate invite link for room={}: {}", roomId, e.getMessage()));
    }

    /**
     * @deprecated Use {@link #generateInviteLink(String, String)}.
     */
    @Deprecated
    public Mono<String> generateInviteLink(String roomId, Long requesterTgId) {
        return roomRepository.findById(roomId)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> {
                    if (!java.util.Objects.equals(room.getOwnerTgId(), requesterTgId)) {
                        return Mono.error(new SecurityException("NOT_OWNER"));
                    }
                    return saveInviteToken(roomId, requesterTgId, null, null);
                })
                .doOnSuccess(url -> LOG.info("Invite link generated for room={} by tgId={}", roomId, requesterTgId))
                .doOnError(e -> LOG.warn("Failed to generate invite link for room={}: {}", roomId, e.getMessage()));
    }

    /**
     * Revoke a single invite token. Owner-only.
     */
    public Mono<Void> revokeInvite(String roomId, String token, String requesterInternalId) {
        return roomRepository.findById(roomId)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> {
                    if (room.getOwnerInternalId() == null
                            || !room.getOwnerInternalId().equals(requesterInternalId)) {
                        return Mono.error(new SecurityException("NOT_OWNER"));
                    }
                    return inviteTokenRepository.findByToken(token)
                            .switchIfEmpty(Mono.error(new IllegalArgumentException("INVALID_TOKEN")))
                            .flatMap(stored -> {
                                if (!roomId.equals(stored.getRoomId())) {
                                    return Mono.error(new IllegalArgumentException("INVALID_TOKEN"));
                                }
                                return inviteTokenRepository.deleteTokenAndIndex(token, roomId);
                            });
                })
                .doOnSuccess(v -> LOG.info("Invite token revoked for room={} by internalId={}", roomId,
                        requesterInternalId));
    }

    /**
     * List active invite tokens for a room. Owner-only.
     */
    public Mono<RoomInvitesEvent> getInvites(String roomId, String requesterInternalId) {
        return roomRepository.findById(roomId)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> {
                    if (room.getOwnerInternalId() == null
                            || !room.getOwnerInternalId().equals(requesterInternalId)) {
                        return Mono.error(new SecurityException("NOT_OWNER"));
                    }
                    return inviteTokenRepository.findAllByRoomId(roomId)
                            .map(this::toInviteInfo)
                            .collectList()
                            .map(invites -> RoomInvitesEvent.success(roomId, invites));
                });
    }

    private Mono<String> saveInviteToken(String roomId,
                                         Long createdByTgId,
                                         Long expiresInSeconds,
                                         Integer maxUses) {
        String tokenValue = generateSecureToken();
        long expiresAt = resolveExpiresAt(expiresInSeconds);
        Integer normalizedMaxUses = normalizeMaxUses(maxUses);

        InviteToken token = InviteToken.builder()
                .token(tokenValue)
                .roomId(roomId)
                .createdBy(createdByTgId)
                .expiresAt(expiresAt)
                .maxUses(normalizedMaxUses)
                .usedCount(0)
                .build();

        return inviteTokenRepository.save(token)
                .thenReturn(buildInviteUrl(tokenValue));
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
     * @return Mono with the {@link Room}, or error for INVALID_TOKEN / INVITE_EXPIRED / INVITE_EXHAUSTED
     */
    public Mono<Room> resolveRoomByToken(String inviteToken) {
        return inviteTokenRepository.findByToken(inviteToken)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("INVALID_TOKEN")))
                .flatMap(token -> validateInviteToken(token)
                        .then(roomRepository.findById(token.getRoomId())
                                .switchIfEmpty(Mono.error(new IllegalArgumentException("INVALID_TOKEN")))));
    }

    /**
     * Atomically consume one use of a limited invite token and delete it when exhausted.
     */
    public Mono<Void> consumeInviteUse(String inviteToken) {
        return inviteTokenRepository.findByToken(inviteToken)
                .flatMap(token -> {
                    if (isUnlimited(token.getMaxUses())) {
                        return Mono.empty();
                    }
                    return inviteTokenRepository.incrementUseCount(inviteToken)
                            .flatMap(newCount -> {
                                if (newCount < 0) {
                                    return Mono.empty();
                                }
                                if (newCount >= token.getMaxUses()) {
                                    return inviteTokenRepository.deleteTokenAndIndex(inviteToken, token.getRoomId());
                                }
                                return Mono.empty();
                            });
                });
    }

    /**
     * Whether the token has reached its use limit (unlimited tokens never exhaust).
     */
    public static boolean isExhausted(InviteToken token) {
        return !isUnlimited(token.getMaxUses())
                && token.getUsedCount() != null
                && token.getUsedCount() >= token.getMaxUses();
    }

    /**
     * {@code null} or {@code <= 0} means unlimited uses.
     */
    public static boolean isUnlimited(Integer maxUses) {
        return maxUses == null || maxUses <= 0;
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private Mono<Void> validateInviteToken(InviteToken token) {
        if (token.getExpiresAt() < Instant.now().toEpochMilli()) {
            return inviteTokenRepository.deleteTokenAndIndex(token.getToken(), token.getRoomId())
                    .then(Mono.error(new IllegalArgumentException("INVITE_EXPIRED")));
        }
        if (isExhausted(token)) {
            return inviteTokenRepository.deleteTokenAndIndex(token.getToken(), token.getRoomId())
                    .then(Mono.error(new IllegalArgumentException("INVITE_EXHAUSTED")));
        }
        return Mono.empty();
    }

    private RoomInvitesEvent.InviteInfo toInviteInfo(StoredInviteToken stored) {
        return RoomInvitesEvent.InviteInfo.builder()
                .token(stored.token())
                .url(buildInviteUrl(stored.token()))
                .createdAt(stored.createdAt())
                .expiresAt(stored.expiresAt())
                .maxUses(stored.maxUses())
                .usedCount(stored.usedCount())
                .build();
    }

    private long resolveExpiresAt(Long expiresInSeconds) {
        if (expiresInSeconds == null || expiresInSeconds <= 0) {
            return Instant.now()
                    .plus(InviteToken.DEFAULT_TTL_DAYS, ChronoUnit.DAYS)
                    .toEpochMilli();
        }
        long clampedSeconds = Math.max(MIN_EXPIRES_SECONDS, Math.min(expiresInSeconds, MAX_EXPIRES_SECONDS));
        return Instant.now().plusSeconds(clampedSeconds).toEpochMilli();
    }

    private static Integer normalizeMaxUses(Integer maxUses) {
        if (maxUses == null || maxUses <= 0) {
            return null;
        }
        return maxUses;
    }

    private String generateSecureToken() {
        byte[] bytes = new byte[TOKEN_BYTES];
        SECURE_RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }
}

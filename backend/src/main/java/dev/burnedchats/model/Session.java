package dev.burnedchats.model;

import dev.burnedchats.util.InternalIds;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.Instant;

/**
 * Encrypted chat session between two users.
 *
 * <p>Represents an active or pending chat session. The server only stores
 * metadata - actual encryption keys are never transmitted to or stored
 * on the server.
 *
 * <p>Session lifecycle:
 * <ol>
 *   <li>PENDING - Request sent, waiting for acceptance</li>
 *   <li>HANDSHAKE - Both parties exchanging public keys</li>
 *   <li>ACTIVE - Chat is active, messages can be exchanged</li>
 *   <li>BURNED - Session destroyed by either party</li>
 * </ol>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Session implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * Default session TTL in minutes (1 hour).
     */
    public static final int DEFAULT_TTL_MINUTES = 60;

    /**
     * Unique session identifier (UUID).
     */
    private String id;

    /**
     * Telegram user ID of the session initiator.
     */
    private String initiatorInternalId;
    private Long initiatorTelegramId;

    /**
     * Telegram user ID of the session responder.
     */
    private String responderInternalId;
    private Long responderTelegramId;

    /**
     * Current session status.
     */
    @Builder.Default
    private SessionStatus status = SessionStatus.PENDING;

    /**
     * Timestamp when session was created.
     */
    @Builder.Default
    private Instant createdAt = Instant.now();

    /**
     * Timestamp of last activity in this session.
     */
    @Builder.Default
    private Instant lastActivityAt = Instant.now();

    /**
     * Timestamp when handshake was completed.
     * Null if not yet completed.
     */
    private Instant handshakeCompletedAt;

    /**
     * Whether initiator has verified the fingerprint.
     */
    @Builder.Default
    private boolean initiatorVerified = false;

    /**
     * Whether responder has verified the fingerprint.
     */
    @Builder.Default
    private boolean responderVerified = false;

    /**
     * Optional secret question for verification.
     */
    private String secretQuestion;

    /**
     * Base64-encoded SHA-256 of the normalized expected answer (initiator),
     * set when a secret question is used. Compared on accept with the
     * responder's answer; plaintext is never stored.
     */
    private String secretAnswerHash;

    /**
     * Temporary storage for initiator's public key during handshake.
     * Stored in Redis until both keys are exchanged, then cleared.
     * Server never processes these cryptographically - only relays.
     */
    private String initiatorPublicKey;

    /**
     * Temporary storage for responder's public key during handshake.
     * Stored in Redis until both keys are exchanged, then cleared.
     * Server never processes these cryptographically - only relays.
     */
    private String responderPublicKey;

    /**
     * Session status enumeration.
     */
    public enum SessionStatus {
        /**
         * Request sent, waiting for acceptance.
         */
        PENDING,

        /**
         * Both parties exchanging public keys.
         */
        HANDSHAKE,

        /**
         * Chat is active.
         */
        ACTIVE,

        /**
         * Session destroyed.
         */
        BURNED,

        /**
         * Request expired or rejected.
         */
        EXPIRED
    }

    /**
     * Check if the given user is a participant in this session.
     *
     * @param userId Telegram user ID
     * @return true if user is initiator or responder
     */
    public boolean isParticipant(String userId) {
        return userId != null
                && (userId.equals(initiatorInternalId) || userId.equals(responderInternalId));
    }

    public boolean isParticipant(Long telegramId) {
        return telegramId != null
                && (telegramId.equals(initiatorTelegramId) || telegramId.equals(responderTelegramId));
    }

    public Long getInitiatorId() {
        return initiatorTelegramId;
    }

    public Long getResponderId() {
        return responderTelegramId;
    }

    /**
     * Get the peer's user ID for a given participant.
     *
     * @param userId Telegram user ID of one participant
     * @return user ID of the other participant, or null if not a participant
     */
    public String getPeerInternalId(String userId) {
        if (userId == null) {
            return null;
        }
        if (userId.equals(initiatorInternalId)) {
            return responderInternalId;
        }
        if (userId.equals(responderInternalId)) {
            return initiatorInternalId;
        }
        return null;
    }

    public String getPeerId(String userId) {
        return getPeerInternalId(userId);
    }

    public Long getPeerId(Long telegramId) {
        if (telegramId == null) {
            return null;
        }
        if (telegramId.equals(initiatorTelegramId)) {
            return responderTelegramId;
        }
        if (telegramId.equals(responderTelegramId)) {
            return initiatorTelegramId;
        }
        return null;
    }

    /**
     * Update last activity timestamp.
     */
    public void touch() {
        this.lastActivityAt = Instant.now();
    }

    /**
     * Calculate expiration timestamp based on creation time (5.1.4).
     *
     * @return expiration instant (1 hour after creation)
     */
    public Instant getExpiresAt() {
        return createdAt.plusSeconds(DEFAULT_TTL_MINUTES * 60L);
    }

    /**
     * Check if the session has expired (5.1.4).
     *
     * @return true if expired
     */
    public boolean isExpired() {
        return Instant.now().isAfter(getExpiresAt());
    }

    /**
     * Get remaining time in seconds until expiration (5.1.4).
     *
     * @return remaining seconds, 0 if expired
     */
    public long getRemainingSeconds() {
        long remaining = java.time.Duration.between(Instant.now(), getExpiresAt()).getSeconds();
        return Math.max(0, remaining);
    }

    /**
     * Check if the given user is the initiator of this session.
     *
     * @param userId Telegram user ID
     * @return true if user is the initiator
     */
    public boolean isInitiator(String userId) {
        return userId != null && userId.equals(initiatorInternalId);
    }

    public boolean isInitiator(Long telegramId) {
        return telegramId != null && telegramId.equals(initiatorTelegramId);
    }

    /**
     * Check if the given user is the responder of this session.
     *
     * @param userId Telegram user ID
     * @return true if user is the responder
     */
    public boolean isResponder(String userId) {
        return userId != null && userId.equals(responderInternalId);
    }

    public boolean isResponder(Long telegramId) {
        return telegramId != null && telegramId.equals(responderTelegramId);
    }

    /**
     * Set the public key for a participant during handshake.
     *
     * @param userId    Telegram user ID of the participant
     * @param publicKey Base64-encoded public key
     * @return true if key was set, false if user is not a participant
     */
    public boolean setPublicKeyForUser(String userId, String publicKey) {
        if (isInitiator(userId)) {
            this.initiatorPublicKey = publicKey;
            return true;
        }
        if (isResponder(userId)) {
            this.responderPublicKey = publicKey;
            return true;
        }
        return false;
    }

    public boolean setPublicKeyForUser(Long telegramId, String publicKey) {
        if (telegramId == null) {
            return false;
        }
        return setPublicKeyForUser(InternalIds.forTelegramId(telegramId), publicKey);
    }

    /**
     * Get the public key submitted by a participant.
     *
     * @param userId Telegram user ID
     * @return the public key, or null if not yet submitted
     */
    public String getPublicKeyForUser(String userId) {
        if (isInitiator(userId)) {
            return initiatorPublicKey;
        }
        if (isResponder(userId)) {
            return responderPublicKey;
        }
        return null;
    }

    public String getPublicKeyForUser(Long telegramId) {
        if (telegramId == null) {
            return null;
        }
        return getPublicKeyForUser(InternalIds.forTelegramId(telegramId));
    }

    /**
     * Check if both participants have submitted their public keys.
     *
     * @return true if both keys are available
     */
    public boolean areBothKeysReady() {
        return initiatorPublicKey != null && responderPublicKey != null;
    }

    /**
     * Clear temporary public keys after exchange is complete.
     * Called after keys have been relayed to both participants.
     */
    public void clearPublicKeys() {
        this.initiatorPublicKey = null;
        this.responderPublicKey = null;
    }
}




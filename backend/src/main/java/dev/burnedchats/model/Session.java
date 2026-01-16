package dev.burnedchats.model;

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
     * Unique session identifier (UUID).
     */
    private String id;

    /**
     * Telegram user ID of the session initiator.
     */
    private Long initiatorId;

    /**
     * Telegram user ID of the session responder.
     */
    private Long responderId;

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
     * Hash of the secret answer (for verification).
     */
    private String secretAnswerHash;

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
    public boolean isParticipant(Long userId) {
        return userId != null
                && (userId.equals(initiatorId) || userId.equals(responderId));
    }

    /**
     * Get the peer's user ID for a given participant.
     *
     * @param userId Telegram user ID of one participant
     * @return user ID of the other participant, or null if not a participant
     */
    public Long getPeerId(Long userId) {
        if (userId == null) {
            return null;
        }
        if (userId.equals(initiatorId)) {
            return responderId;
        }
        if (userId.equals(responderId)) {
            return initiatorId;
        }
        return null;
    }

    /**
     * Update last activity timestamp.
     */
    public void touch() {
        this.lastActivityAt = Instant.now();
    }
}




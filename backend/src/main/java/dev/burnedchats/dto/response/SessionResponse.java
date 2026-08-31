package dev.burnedchats.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Session information response DTO.
 *
 * <p>Used to send session data to clients.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SessionResponse {

    /**
     * Session ID.
     */
    private String sessionId;

    /**
     * Current session status.
     */
    private String status;

    /**
     * Peer user information.
     */
    private UserResponse peer;

    /**
     * Whether current user has verified the fingerprint.
     */
    private boolean verified;

    /**
     * Whether peer has verified the fingerprint.
     */
    private boolean peerVerified;

    /**
     * Session creation timestamp.
     */
    private Instant createdAt;

    /**
     * Last activity timestamp.
     */
    private Instant lastActivityAt;

    /**
     * Whether the requester is the session initiator.
     */
    private boolean isInitiator;

    /**
     * Logical expiry: PENDING = {@code createdAt + session.request.ttl}.
     */
    private Instant expiresAt;
}




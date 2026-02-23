package dev.burnedchats.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * Invite token for joining a room via a Telegram deep link.
 *
 * <p>Stored in Redis under key {@code invite:{token}}.
 *
 * <p>TTL: set to {@code expiresAt - now} on creation (default 7 days).
 * When {@code maxUses} is set, the token becomes invalid once the use count is reached.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InviteToken implements Serializable {

    private static final long serialVersionUID = 1L;

    /** Default invite token lifetime in days. */
    public static final int DEFAULT_TTL_DAYS = 7;

    /** The token string (32 bytes hex, cryptographically random). */
    private String token;

    /** UUID of the room this token grants access to. */
    private String roomId;

    /** Telegram ID of the user who created this token (must be room owner). */
    private Long createdBy;

    /** Unix timestamp (ms) when this token expires. */
    private Long expiresAt;

    /**
     * Maximum number of times this token can be used.
     * {@code null} means unlimited uses (subject to TTL).
     */
    private Integer maxUses;

    /** Number of times this token has been used. */
    private Integer usedCount;
}

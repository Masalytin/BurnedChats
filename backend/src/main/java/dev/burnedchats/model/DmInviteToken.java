package dev.burnedchats.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * Opaque personal DM invite token (scanner → chat request to owner).
 *
 * <p>Stored in Redis under key {@code dm_invite:{token}}. Separate from room
 * {@code invite:{token}} (IMP-DMINVITE-01).
 *
 * <p>Default TTL: {@link #DEFAULT_TTL_MINUTES} minutes. Default {@code maxUses}: 1.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DmInviteToken implements Serializable {

    private static final long serialVersionUID = 1L;

    /** Default personal DM invite lifetime in minutes (face-to-face / short share). */
    public static final int DEFAULT_TTL_MINUTES = 10;

    /** Default maximum redemptions (single-use QR / link). */
    public static final int DEFAULT_MAX_USES = 1;

    /** Cryptographically random 32-byte hex token. */
    private String token;

    /** Internal id of the invite owner (recipient of the resulting ChatRequest). */
    private String ownerInternalId;

    /** Unix timestamp (ms) when this token expires. */
    private Long expiresAt;

    /** Maximum redemptions; personal DM v1 always uses a positive cap (default 1). */
    private Integer maxUses;

    /** Number of successful consume attempts (incremented before createSession). */
    private Integer usedCount;
}

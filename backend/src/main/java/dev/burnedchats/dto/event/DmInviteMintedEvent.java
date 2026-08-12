package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Response to {@code /app/dmInvite.mint}.
 *
 * <p>Destination: {@code /user/queue/dm-invite-minted}
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DmInviteMintedEvent {

    private boolean success;

    /** Opaque token (64 hex). Present only when {@code success = true}. */
    private String token;

    /** Canonical deep-link URL including {@code dm_invite_} prefix. */
    private String inviteUrl;

    /** Unix ms expiry. */
    private Long expiresAt;

    /** Use cap (default 1). */
    private Integer maxUses;

    /**
     * Error code when {@code success = false}.
     * Gate failures (PoW / rate limit) use {@code /queue/errors} instead.
     */
    private String error;

    public static DmInviteMintedEvent success(String token, String inviteUrl, Long expiresAt, Integer maxUses) {
        return DmInviteMintedEvent.builder()
                .success(true)
                .token(token)
                .inviteUrl(inviteUrl)
                .expiresAt(expiresAt)
                .maxUses(maxUses)
                .build();
    }

    public static DmInviteMintedEvent error(String errorCode) {
        return DmInviteMintedEvent.builder()
                .success(false)
                .error(errorCode)
                .build();
    }
}

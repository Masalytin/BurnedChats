package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request payload for {@code /app/room.getInviteLink}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class GetInviteLinkRequest {

    /** UUID of the room for which to generate an invite link. */
    @NotBlank
    private String roomId;

    /**
     * Optional lifetime in seconds from now.
     * When omitted, defaults to {@link dev.burnedchats.model.InviteToken#DEFAULT_TTL_DAYS} days.
     */
    private Long expiresInSeconds;

    /**
     * Optional maximum number of successful joins via this token.
     * When omitted or {@code 0}, the token has unlimited uses (subject to TTL).
     */
    private Integer maxUses;
}

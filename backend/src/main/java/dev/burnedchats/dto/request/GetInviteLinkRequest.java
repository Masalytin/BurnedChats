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
}

package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request payload for {@code /app/room.getMembers}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class GetRoomMembersRequest {

    /** UUID of the room to fetch members for. */
    @NotBlank
    private String roomId;
}

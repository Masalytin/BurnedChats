package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.Data;

/**
 * Payload for STOMP {@code /app/room.acceptJoin} and {@code /app/room.rejectJoin}.
 *
 * <p>Both operations share the same shape: the owner identifies the request by
 * room ID and the sender's Telegram ID. The handler routing determines whether
 * it is an accept or reject action.
 *
 * <p>Only the room owner is authorised to call these endpoints.
 */
@Data
public class RoomJoinDecisionRequest {

    /** UUID of the room. */
    @NotBlank
    private String roomId;

    /** Telegram ID of the user whose join request is being decided. */
    @NotNull
    @Positive
    private Long senderTgId;
}

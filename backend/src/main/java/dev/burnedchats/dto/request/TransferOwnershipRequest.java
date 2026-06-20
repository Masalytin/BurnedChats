package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for the room owner to transfer ownership to another member.
 *
 * <p>Sent via STOMP to {@code /app/room.transferOwnership}. Only the current owner may invoke
 * this endpoint. The new owner must already be a room member. Group key rekey is not required.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "roomId": "550e8400-e29b-41d4-a716-446655440000",
 *   "newOwnerInternalId": "tg:987654321"
 * }
 * }</pre>
 *
 * @see dev.burnedchats.handler.RoomHandler
 * @see dev.burnedchats.dto.event.RoomOwnershipTransferredEvent
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TransferOwnershipRequest {

    /** The room UUID. */
    @NotBlank(message = "Room ID is required")
    private String roomId;

    /** Internal ID of the member who will become the new owner. Must be a current member. */
    @NotBlank(message = "New owner internal ID is required")
    private String newOwnerInternalId;
}

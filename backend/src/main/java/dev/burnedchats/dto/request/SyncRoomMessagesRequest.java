package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;

/**
 * Request to sync room messages after reconnection.
 *
 * <p>Sent by client via STOMP to {@code /app/room.message.sync} when connecting
 * or reconnecting to a room. Returns all messages currently stored in
 * {@code messages:{roomId}} so the client can fill in any gaps.
 *
 * @param roomId room ID to sync messages for
 * @see dev.burnedchats.handler.RoomMessageHandler
 */
public record SyncRoomMessagesRequest(
        @NotBlank(message = "Room ID is required")
        String roomId
) {
}

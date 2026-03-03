package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Acknowledgment event sent to the message sender after a room message is broadcast.
 *
 * <p>Destination: {@code /user/queue/room-message-sent}
 *
 * <p>Allows the sender to transition their local message from {@code sending} to
 * {@code sent} status once the server confirms the message was broadcast successfully.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomMessageSentEvent {

    /** Whether the message was processed successfully. */
    private boolean success;

    /** UUID of the room. */
    private String roomId;

    /** Client-generated message ID echoed back for correlation. */
    private String messageId;

    /** Server-side timestamp when the message was broadcast. */
    private Instant serverTimestamp;

    /** Error code — present only when {@code success=false}. */
    private String error;

    public static RoomMessageSentEvent success(String roomId, String messageId, Instant serverTimestamp) {
        return RoomMessageSentEvent.builder()
                .success(true)
                .roomId(roomId)
                .messageId(messageId)
                .serverTimestamp(serverTimestamp)
                .build();
    }

    public static RoomMessageSentEvent error(String roomId, String messageId, String errorCode) {
        return RoomMessageSentEvent.builder()
                .success(false)
                .roomId(roomId)
                .messageId(messageId)
                .error(errorCode)
                .build();
    }
}

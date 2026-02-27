package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for sending an encrypted message to a room.
 *
 * <p>Sent by client via STOMP to {@code /app/room.message.send}.
 * Message content is encrypted client-side with the room's group key (E2EE).
 * The server relays the encrypted blob to all room subscribers and stores
 * it in Redis for offline delivery.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "roomId": "550e8400-e29b-41d4-a716-446655440000",
 *   "messageId": "msg-123456789",
 *   "encryptedContent": "base64-encoded-ciphertext",
 *   "iv": "base64-encoded-iv",
 *   "timestamp": 1705312200000
 * }
 * }</pre>
 *
 * @see dev.burnedchats.handler.RoomMessageHandler
 * @see dev.burnedchats.dto.event.NewRoomMessageEvent
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SendRoomMessageRequest {

    /**
     * The room ID (UUID) to send the message to.
     */
    @NotBlank(message = "Room ID is required")
    private String roomId;

    /**
     * Client-generated message ID for deduplication and delivery tracking.
     */
    @NotBlank(message = "Message ID is required")
    @Size(max = 64, message = "Message ID must not exceed 64 characters")
    private String messageId;

    /**
     * The encrypted message content (Base64-encoded ciphertext).
     *
     * <p>Encrypted client-side with the room's group AES key.
     * Server never decrypts this.
     */
    @NotBlank(message = "Encrypted content is required")
    @Size(max = 65536, message = "Message content must not exceed 64KB")
    private String encryptedContent;

    /**
     * The initialization vector used for encryption (Base64-encoded).
     */
    @NotBlank(message = "IV is required")
    @Size(min = 16, max = 24, message = "IV must be 16-24 characters (Base64-encoded 12 bytes)")
    private String iv;

    /**
     * Client-side timestamp when message was created (epoch millis).
     */
    @NotNull(message = "Timestamp is required")
    private Long timestamp;
}

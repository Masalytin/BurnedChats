package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Event DTO broadcast to room subscribers when a new message is sent.
 *
 * <p>Sent via STOMP to {@code /topic/room/{roomId}} when a room member
 * sends an encrypted message. All subscribers of the room topic receive
 * this event immediately.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "success": true,
 *   "roomId": "550e8400-e29b-41d4-a716-446655440000",
 *   "messageId": "msg-123456789",
 *   "senderTgId": 123456789,
 *   "encryptedContent": "base64-encoded-ciphertext",
 *   "iv": "base64-encoded-iv",
 *   "clientTimestamp": 1705312200000,
 *   "serverTimestamp": "2024-01-15T10:30:00Z"
 * }
 * }</pre>
 *
 * <p>Upon receiving this event, the client should:
 * <ol>
 *   <li>Decode the Base64 IV and ciphertext</li>
 *   <li>Decrypt using AES-GCM with the room's group key</li>
 *   <li>Display the decrypted message with sender info</li>
 * </ol>
 *
 * @see dev.burnedchats.handler.RoomMessageHandler
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class NewRoomMessageEvent {

    /**
     * Whether the message was broadcast successfully.
     */
    private boolean success;

    /**
     * The room ID (UUID).
     */
    private String roomId;

    /**
     * The client-generated message ID for tracking and deduplication.
     */
    private String messageId;

    /**
     * Telegram user ID of the sender (for display).
     */
    private Long senderTgId;

    /**
     * Display name of the sender (firstName or @username from server-side user cache).
     * May be null if the user is not in cache.
     */
    private String senderName;

    /**
     * The encrypted message content (Base64-encoded ciphertext).
     */
    private String encryptedContent;

    /**
     * The initialization vector used for encryption (Base64-encoded).
     */
    private String iv;

    /**
     * Client-side timestamp when message was created (epoch millis).
     */
    private Long clientTimestamp;

    /**
     * Server-side timestamp when message was received.
     */
    private Instant serverTimestamp;

    /**
     * Message type: {@code "text"}, {@code "image"}, {@code "video"}, or {@code "file"}.
     * Defaults to {@code "text"} for backward compatibility.
     */
    private String type;

    // ---- File-specific fields (present when type != "text") ----

    /**
     * ID of the uploaded encrypted file.
     */
    private String fileId;

    /**
     * ID of the uploaded encrypted thumbnail.
     */
    private String thumbnailFileId;

    /**
     * Base64-encoded encrypted file metadata (fileName, mimeType).
     */
    private String encryptedMeta;

    /**
     * Original file size in bytes.
     */
    private Long fileSize;

    /**
     * Optional ID of the message this one replies to (plaintext metadata).
     */
    private String replyToMessageId;

    /**
     * Error code if operation failed.
     */
    private String error;

    /**
     * Create an error event sent back to the sender.
     */
    public static NewRoomMessageEvent error(String roomId, String messageId, String errorCode) {
        return NewRoomMessageEvent.builder()
                .success(false)
                .roomId(roomId)
                .messageId(messageId)
                .error(errorCode)
                .build();
    }
}

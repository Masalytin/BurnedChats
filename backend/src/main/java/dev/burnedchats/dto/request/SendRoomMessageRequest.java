package dev.burnedchats.dto.request;

import dev.burnedchats.validation.FileMessageAware;
import dev.burnedchats.validation.ValidFileMessage;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
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
 * <p>Supports text and file messages. For file messages ({@code type} is
 * {@code "image"}, {@code "video"}, or {@code "file"}), {@code fileId} is
 * required and {@code encryptedContent} may contain an optional encrypted caption.
 *
 * <p>Example text message payload:
 * <pre>{@code
 * {
 *   "roomId": "550e8400-e29b-41d4-a716-446655440000",
 *   "messageId": "msg-123456789",
 *   "encryptedContent": "base64-encoded-ciphertext",
 *   "iv": "base64-encoded-iv",
 *   "timestamp": 1705312200000,
 *   "type": "text"
 * }
 * }</pre>
 *
 * <p>Example file message payload:
 * <pre>{@code
 * {
 *   "roomId": "550e8400-e29b-41d4-a716-446655440000",
 *   "messageId": "msg-123456790",
 *   "encryptedContent": "base64-encoded-caption-or-empty",
 *   "iv": "base64-encoded-iv",
 *   "timestamp": 1705312200000,
 *   "type": "image",
 *   "fileId": "file-uuid",
 *   "thumbnailFileId": "thumb-uuid",
 *   "encryptedMeta": "base64-encrypted-filename-mimetype",
 *   "fileSize": 1048576
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
@ValidFileMessage
public class SendRoomMessageRequest implements FileMessageAware {

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
     * <p>For text messages: encrypted with the room's group AES key.
     * For file messages: optional encrypted caption.
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

    /**
     * Message type. {@code null} is treated as {@code "text"} for backward compatibility.
     */
    @Pattern(regexp = "^(text|image|video|file)$", message = "Type must be text, image, video, or file")
    @Builder.Default
    private String type = "text";

    // ---- File-specific fields (required when type != "text") ----

    /**
     * ID of the uploaded encrypted file. Required for non-text message types.
     */
    @Size(max = 128, message = "File ID must not exceed 128 characters")
    private String fileId;

    /**
     * ID of the uploaded encrypted thumbnail (optional, typically for images/video).
     */
    @Size(max = 128, message = "Thumbnail file ID must not exceed 128 characters")
    private String thumbnailFileId;

    /**
     * Base64-encoded encrypted file metadata ({@code fileName}, {@code mimeType}).
     * Encrypted client-side; the server treats it as an opaque blob.
     */
    @Size(max = 4096, message = "Encrypted meta must not exceed 4KB")
    private String encryptedMeta;

    /**
     * Original file size in bytes (plaintext — server already knows blob size).
     */
    @Positive(message = "File size must be positive")
    private Long fileSize;
}

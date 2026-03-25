package dev.burnedchats.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.Instant;

/**
 * Encrypted message stored in a room's message list.
 *
 * <p>Room messages are stored in Redis as a shared list per room.
 * The server acts as a relay only — it never decrypts content.
 * All messages are stored encrypted and expire after 24 hours.
 *
 * <p>Storage structure in Redis:
 * <ul>
 *   <li>Key: {@code messages:{roomId}} (List)</li>
 *   <li>Value: JSON-serialized RoomMessage objects</li>
 *   <li>TTL: 24 hours</li>
 * </ul>
 *
 * <p>Security notes:
 * <ul>
 *   <li>Content is encrypted with the room's group key (E2EE)</li>
 *   <li>Server stores only encrypted blobs and metadata</li>
 *   <li>senderTgId is stored for display purposes (not for decryption)</li>
 * </ul>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomMessage implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * Client-generated message ID for deduplication.
     */
    private String messageId;

    /**
     * The room ID (UUID) this message belongs to.
     */
    private String roomId;

    /**
     * Telegram user ID of the sender (for display, not for decryption).
     */
    private Long senderTgId;

    /**
     * The encrypted message content (Base64-encoded ciphertext).
     */
    private String encryptedContent;

    /**
     * The initialization vector (Base64-encoded).
     */
    private String iv;

    /**
     * Client-side timestamp when message was created (epoch millis).
     */
    private Long clientTimestamp;

    /**
     * Server-side timestamp when message was received.
     */
    @Builder.Default
    private Instant serverTimestamp = Instant.now();

    /**
     * Message type: {@code "text"}, {@code "image"}, {@code "video"}, or {@code "file"}.
     * Defaults to {@code "text"} for backward compatibility.
     */
    @Builder.Default
    private String type = "text";

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
}

package dev.burnedchats.model;

import dev.burnedchats.util.InternalIds;
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
 *   <li>Sender identity is stored for display and authorization (not for decryption)</li>
 * </ul>
 */
@Data
@Builder(toBuilder = true)
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
     * Stable internal user id of the sender (canonical identity).
     */
    private String senderInternalId;

    /**
     * Telegram user ID of the sender when linked; null for wallet-only senders.
     *
     * @deprecated Use {@link #senderInternalId} for authorization and fan-out.
     */
    @Deprecated
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

    /**
     * Optional client message ID this message replies to (plaintext relay metadata).
     */
    private String replyToMessageId;

    /**
     * Server time of the last successful edit, if any.
     */
    private Instant editedAt;

    /**
     * Sender identity for membership and edit checks — falls back to deterministic TG mapping.
     */
    public String getSenderKey() {
        if (senderInternalId != null && !senderInternalId.isBlank()) {
            return senderInternalId;
        }
        if (senderTgId != null) {
            return InternalIds.forTelegramId(senderTgId);
        }
        return null;
    }
}

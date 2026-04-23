package dev.burnedchats.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.Instant;

/**
 * Encrypted message queued for offline delivery.
 *
 * <p>When a recipient is offline, messages are temporarily stored in Redis
 * for later delivery. The server never decrypts message content - it only
 * stores and relays the encrypted payload.
 *
 * <p>Messages are automatically expired after 1 hour if not delivered,
 * matching the session TTL.
 *
 * <p>Storage structure in Redis:
 * <ul>
 *   <li>Key: {@code messages:{recipientId}:{sessionId}} (List)</li>
 *   <li>Value: JSON-serialized Message objects</li>
 * </ul>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Message implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * Client-generated message ID for deduplication.
     */
    private String messageId;

    /**
     * The session ID (UUID).
     */
    private String sessionId;

    /**
     * Telegram user ID of the sender.
     */
    private Long senderId;

    /**
     * Telegram user ID of the recipient.
     */
    private Long recipientId;

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
     * Create a Message from a send request.
     *
     * @param sessionId        the session ID
     * @param senderId         the sender's user ID
     * @param recipientId      the recipient's user ID
     * @param messageId        the client-generated message ID
     * @param encryptedContent the encrypted content
     * @param iv               the initialization vector
     * @param clientTimestamp  the client timestamp
     * @return the constructed Message
     */
    @SuppressWarnings("checkstyle:ParameterNumber")
    public static Message fromRequest(String sessionId, Long senderId, Long recipientId,
                                       String messageId, String encryptedContent,
                                       String iv, Long clientTimestamp, String replyToMessageId) {
        return Message.builder()
                .messageId(messageId)
                .sessionId(sessionId)
                .senderId(senderId)
                .recipientId(recipientId)
                .encryptedContent(encryptedContent)
                .iv(iv)
                .clientTimestamp(clientTimestamp)
                .serverTimestamp(Instant.now())
                .replyToMessageId(replyToMessageId)
                .build();
    }

    /**
     * Create a file Message from a send request.
     *
     * @param sessionId        the session ID
     * @param senderId         the sender's user ID
     * @param recipientId      the recipient's user ID
     * @param messageId        the client-generated message ID
     * @param encryptedContent the encrypted content (caption or empty)
     * @param iv               the initialization vector
     * @param clientTimestamp   the client timestamp
     * @param type             the message type (image, video, file)
     * @param fileId           the uploaded file ID
     * @param thumbnailFileId  the thumbnail file ID (nullable)
     * @param encryptedMeta    encrypted file metadata (nullable)
     * @param fileSize         original file size in bytes (nullable)
     * @return the constructed Message
     */
    @SuppressWarnings("checkstyle:ParameterNumber")
    public static Message fromFileRequest(String sessionId, Long senderId, Long recipientId,
                                           String messageId, String encryptedContent,
                                           String iv, Long clientTimestamp,
                                           String type, String fileId, String thumbnailFileId,
                                           String encryptedMeta, Long fileSize, String replyToMessageId) {
        return Message.builder()
                .messageId(messageId)
                .sessionId(sessionId)
                .senderId(senderId)
                .recipientId(recipientId)
                .encryptedContent(encryptedContent)
                .iv(iv)
                .clientTimestamp(clientTimestamp)
                .serverTimestamp(Instant.now())
                .type(type)
                .fileId(fileId)
                .thumbnailFileId(thumbnailFileId)
                .encryptedMeta(encryptedMeta)
                .fileSize(fileSize)
                .replyToMessageId(replyToMessageId)
                .build();
    }
}

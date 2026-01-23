package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for sending an encrypted message.
 *
 * <p>Sent by client via STOMP to {@code /app/message.send} during an active
 * chat session. The message content is already encrypted client-side using
 * AES-256-GCM with the shared secret derived during handshake.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "sessionId": "550e8400-e29b-41d4-a716-446655440000",
 *   "messageId": "msg-123456789",
 *   "encryptedContent": "base64-encoded-ciphertext",
 *   "iv": "base64-encoded-iv",
 *   "timestamp": 1705312200000
 * }
 * }</pre>
 *
 * <p>Security notes:
 * <ul>
 *   <li>The server never decrypts message content</li>
 *   <li>Content is relayed as-is to the recipient</li>
 *   <li>Messages are temporarily queued if recipient is offline</li>
 *   <li>Messages are deleted from queue after delivery</li>
 * </ul>
 *
 * @see dev.burnedchats.handler.MessageHandler
 * @see dev.burnedchats.dto.event.NewMessageEvent
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SendMessageRequest {

    /**
     * The session ID for the chat (UUID).
     *
     * <p>Must match an existing session in ACTIVE status
     * where the current user is a participant.
     */
    @NotBlank(message = "Session ID is required")
    private String sessionId;

    /**
     * Client-generated message ID for deduplication and delivery tracking.
     *
     * <p>Should be unique per message. Used to:
     * <ul>
     *   <li>Track message delivery status</li>
     *   <li>Prevent duplicate message processing</li>
     *   <li>Correlate acknowledgments</li>
     * </ul>
     */
    @NotBlank(message = "Message ID is required")
    @Size(max = 64, message = "Message ID must not exceed 64 characters")
    private String messageId;

    /**
     * The encrypted message content (Base64-encoded ciphertext).
     *
     * <p>This is the AES-256-GCM encrypted message content, Base64-encoded.
     * The server does not decrypt this - it only relays to the recipient.
     *
     * <p>Maximum size: 64KB (to prevent abuse while allowing reasonable messages).
     */
    @NotBlank(message = "Encrypted content is required")
    @Size(max = 65536, message = "Message content must not exceed 64KB")
    private String encryptedContent;

    /**
     * The initialization vector used for encryption (Base64-encoded).
     *
     * <p>This is the 12-byte IV used for AES-GCM encryption, Base64-encoded.
     * Required for the recipient to decrypt the message.
     */
    @NotBlank(message = "IV is required")
    @Size(min = 16, max = 24, message = "IV must be 16-24 characters (Base64-encoded 12 bytes)")
    private String iv;

    /**
     * Client-side timestamp when message was created (epoch millis).
     *
     * <p>Used for ordering messages on the client side.
     * The server also adds its own timestamp for verification.
     */
    @NotNull(message = "Timestamp is required")
    private Long timestamp;
}

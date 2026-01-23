package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Event DTO sent to a recipient when a new message arrives.
 *
 * <p>Sent via STOMP to {@code /user/queue/new-message} when a peer
 * sends an encrypted message. The content is encrypted and can only
 * be decrypted by the recipient using the shared secret.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "success": true,
 *   "sessionId": "550e8400-e29b-41d4-a716-446655440000",
 *   "messageId": "msg-123456789",
 *   "senderId": 123456789,
 *   "encryptedContent": "base64-encoded-ciphertext",
 *   "iv": "base64-encoded-iv",
 *   "clientTimestamp": 1705312200000,
 *   "serverTimestamp": "2024-01-15T10:30:00Z",
 *   "error": null
 * }
 * }</pre>
 *
 * <p>Upon receiving this event, the client should:
 * <ol>
 *   <li>Decode the Base64 IV and ciphertext</li>
 *   <li>Decrypt using AES-GCM with the shared key</li>
 *   <li>Display the decrypted message</li>
 *   <li>Send a delivery acknowledgment</li>
 * </ol>
 *
 * @see dev.burnedchats.handler.MessageHandler
 * @see dev.burnedchats.dto.request.SendMessageRequest
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class NewMessageEvent {

    /**
     * Whether the message was delivered successfully.
     */
    private boolean success;

    /**
     * The session ID (UUID).
     */
    private String sessionId;

    /**
     * The client-generated message ID for tracking.
     */
    private String messageId;

    /**
     * The Telegram user ID of the message sender.
     */
    private Long senderId;

    /**
     * The encrypted message content (Base64-encoded ciphertext).
     *
     * <p>This is the AES-256-GCM encrypted content that must be
     * decrypted client-side using the shared secret.
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
     * Error code if message delivery failed.
     *
     * <p>Possible values:
     * <ul>
     *   <li>{@code SESSION_NOT_FOUND} - session doesn't exist</li>
     *   <li>{@code NOT_PARTICIPANT} - user is not a session participant</li>
     *   <li>{@code SESSION_NOT_ACTIVE} - session is not in ACTIVE status</li>
     *   <li>{@code INVALID_MESSAGE} - message format is invalid</li>
     *   <li>{@code RATE_LIMITED} - too many messages</li>
     *   <li>{@code INTERNAL_ERROR} - unexpected server error</li>
     * </ul>
     */
    private String error;

    /**
     * Create a successful new message event.
     *
     * @param sessionId        the session ID
     * @param messageId        the client-generated message ID
     * @param senderId         the sender's Telegram user ID
     * @param encryptedContent the encrypted message content
     * @param iv               the initialization vector
     * @param clientTimestamp  the client-side timestamp
     * @param serverTimestamp  the server-side timestamp
     * @return successful event
     */
    public static NewMessageEvent success(String sessionId, String messageId, Long senderId,
                                           String encryptedContent, String iv,
                                           Long clientTimestamp, Instant serverTimestamp) {
        return NewMessageEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .messageId(messageId)
                .senderId(senderId)
                .encryptedContent(encryptedContent)
                .iv(iv)
                .clientTimestamp(clientTimestamp)
                .serverTimestamp(serverTimestamp)
                .build();
    }

    /**
     * Create an error event.
     *
     * @param sessionId the session ID (may be null)
     * @param messageId the message ID (may be null)
     * @param errorCode the error code
     * @return error event
     */
    public static NewMessageEvent error(String sessionId, String messageId, String errorCode) {
        return NewMessageEvent.builder()
                .success(false)
                .sessionId(sessionId)
                .messageId(messageId)
                .error(errorCode)
                .build();
    }

    /**
     * Create an error event without IDs.
     *
     * @param errorCode the error code
     * @return error event
     */
    public static NewMessageEvent error(String errorCode) {
        return NewMessageEvent.builder()
                .success(false)
                .error(errorCode)
                .build();
    }
}

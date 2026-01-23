package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Event DTO sent to the sender as acknowledgment that their message was processed.
 *
 * <p>Sent via STOMP to {@code /user/queue/message-sent} after a message
 * is successfully relayed (or queued for offline delivery).
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "success": true,
 *   "sessionId": "550e8400-e29b-41d4-a716-446655440000",
 *   "messageId": "msg-123456789",
 *   "serverTimestamp": "2024-01-15T10:30:00Z",
 *   "delivered": true,
 *   "queued": false,
 *   "error": null
 * }
 * }</pre>
 *
 * <p>Status meanings:
 * <ul>
 *   <li>{@code delivered=true, queued=false} - Message delivered immediately</li>
 *   <li>{@code delivered=false, queued=true} - Recipient offline, message queued</li>
 *   <li>{@code delivered=false, queued=false} - Error occurred</li>
 * </ul>
 *
 * @see dev.burnedchats.handler.MessageHandler
 * @see dev.burnedchats.dto.request.SendMessageRequest
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MessageSentEvent {

    /**
     * Whether the message was processed successfully.
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
     * Server-side timestamp when message was processed.
     */
    private Instant serverTimestamp;

    /**
     * Whether the message was delivered immediately to the recipient.
     */
    private boolean delivered;

    /**
     * Whether the message was queued for later delivery (recipient offline).
     */
    private boolean queued;

    /**
     * Error code if message sending failed.
     */
    private String error;

    /**
     * Create a successful sent event with immediate delivery.
     *
     * @param sessionId       the session ID
     * @param messageId       the message ID
     * @param serverTimestamp when the message was processed
     * @return successful event with delivered=true
     */
    public static MessageSentEvent delivered(String sessionId, String messageId, Instant serverTimestamp) {
        return MessageSentEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .messageId(messageId)
                .serverTimestamp(serverTimestamp)
                .delivered(true)
                .queued(false)
                .build();
    }

    /**
     * Create a successful sent event with queued delivery.
     *
     * @param sessionId       the session ID
     * @param messageId       the message ID
     * @param serverTimestamp when the message was processed
     * @return successful event with queued=true
     */
    public static MessageSentEvent queued(String sessionId, String messageId, Instant serverTimestamp) {
        return MessageSentEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .messageId(messageId)
                .serverTimestamp(serverTimestamp)
                .delivered(false)
                .queued(true)
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
    public static MessageSentEvent error(String sessionId, String messageId, String errorCode) {
        return MessageSentEvent.builder()
                .success(false)
                .sessionId(sessionId)
                .messageId(messageId)
                .error(errorCode)
                .build();
    }
}

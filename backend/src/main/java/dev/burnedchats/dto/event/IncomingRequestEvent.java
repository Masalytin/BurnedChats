package dev.burnedchats.dto.event;

import dev.burnedchats.dto.response.UserResponse;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Event DTO sent to the recipient when receiving a chat request.
 *
 * <p>Sent via STOMP to {@code /user/queue/incoming-request} when
 * another user sends a chat request.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "sessionId": "550e8400-e29b-41d4-a716-446655440000",
 *   "sender": {
 *     "id": 987654321,
 *     "username": "alice",
 *     "displayName": "Alice Smith",
 *     "photoUrl": "https://...",
 *     "online": true,
 *     "premium": false
 *   },
 *   "hasSecretQuestion": true,
 *   "secretQuestion": "What was our secret code?",
 *   "createdAt": "2024-01-15T10:30:00Z",
 *   "expiresAt": "2024-01-15T10:35:00Z"
 * }
 * }</pre>
 *
 * <p>If the recipient is not currently online, they will receive
 * a Telegram notification with a button to open the Mini App.
 *
 * @see dev.burnedchats.handler.SessionHandler
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class IncomingRequestEvent {

    /**
     * The session ID for this request (UUID).
     * Used when accepting or rejecting the request.
     */
    private String sessionId;

    /**
     * Information about the user who sent the request.
     */
    private UserResponse sender;

    /**
     * Whether this request includes a secret question
     * that must be answered before accepting.
     */
    private boolean hasSecretQuestion;

    /**
     * The secret question (if hasSecretQuestion is true).
     * Null if no secret question was provided.
     */
    private String secretQuestion;

    /**
     * Timestamp when the request was created.
     */
    private Instant createdAt;

    /**
     * Timestamp when the request will expire.
     * Requests typically expire after 5 minutes.
     */
    private Instant expiresAt;

    /**
     * Create an incoming request event from session data.
     *
     * @param sessionId       the session ID
     * @param sender          sender user info
     * @param secretQuestion  optional secret question
     * @param createdAt       creation timestamp
     * @param expiresAt       expiration timestamp
     * @return incoming request event
     */
    public static IncomingRequestEvent create(String sessionId, UserResponse sender,
                                               String secretQuestion,
                                               Instant createdAt, Instant expiresAt) {
        return IncomingRequestEvent.builder()
                .sessionId(sessionId)
                .sender(sender)
                .hasSecretQuestion(secretQuestion != null && !secretQuestion.isBlank())
                .secretQuestion(secretQuestion)
                .createdAt(createdAt)
                .expiresAt(expiresAt)
                .build();
    }
}

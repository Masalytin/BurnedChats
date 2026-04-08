package dev.burnedchats.dto.event;

import dev.burnedchats.dto.response.UserResponse;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Event DTO sent to the initiator after session creation.
 *
 * <p>Sent via STOMP to {@code /user/queue/session-created} after
 * a chat session request has been successfully created.
 *
 * <p>Example successful response:
 * <pre>{@code
 * {
 *   "success": true,
 *   "sessionId": "550e8400-e29b-41d4-a716-446655440000",
 *   "recipient": {
 *     "id": 123456789,
 *     "username": "johndoe",
 *     "displayName": "John Doe",
 *     "online": true
 *   },
 *   "hasSecretQuestion": true,
 *   "createdAt": "2024-01-15T10:30:00Z",
 *   "expiresAt": "2024-01-15T10:35:00Z",
 *   "error": null
 * }
 * }</pre>
 *
 * <p>Example error response:
 * <pre>{@code
 * {
 *   "success": false,
 *   "sessionId": null,
 *   "recipient": null,
 *   "hasSecretQuestion": false,
 *   "createdAt": null,
 *   "expiresAt": null,
 *   "error": "ALREADY_HAS_SESSION"
 * }
 * }</pre>
 *
 * @see dev.burnedchats.handler.SessionHandler
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SessionCreatedEvent {

    /**
     * Whether the session was created successfully.
     */
    private boolean success;

    /**
     * The created session ID (UUID).
     * Null if creation failed.
     */
    private String sessionId;

    /**
     * Information about the recipient user.
     * Null if creation failed.
     */
    private UserResponse recipient;

    /**
     * Whether the request includes a secret question.
     */
    private boolean hasSecretQuestion;

    /**
     * Timestamp when the request was created.
     */
    private Instant createdAt;

    /**
     * Timestamp when the request will expire.
     */
    private Instant expiresAt;

    /**
     * Error code if session creation failed.
     *
     * <p>Possible values:
     * <ul>
     *   <li>{@code SELF_REQUEST} - user tried to create session with themselves</li>
     *   <li>{@code ALREADY_HAS_SESSION} - user already has an active session</li>
     *   <li>{@code RECIPIENT_HAS_SESSION} - recipient already has an active session</li>
     *   <li>{@code PENDING_REQUEST_EXISTS} - there's already a pending request to this recipient</li>
     *   <li>{@code EXPECTED_ANSWER_REQUIRED} - secret question set but expected answer missing or blank</li>
     *   <li>{@code EXPECTED_ANSWER_TOO_LONG} - expected answer exceeds max length</li>
     *   <li>{@code RECIPIENT_NOT_FOUND} - recipient user not found in cache</li>
     *   <li>{@code RATE_LIMITED} - too many requests</li>
     * </ul>
     */
    private String error;

    /**
     * Create a successful session created event.
     *
     * @param sessionId         the created session ID
     * @param recipient         recipient user info
     * @param hasSecretQuestion whether request has secret question
     * @param createdAt         creation timestamp
     * @param expiresAt         expiration timestamp
     * @return successful event
     */
    public static SessionCreatedEvent success(String sessionId, UserResponse recipient,
                                               boolean hasSecretQuestion,
                                               Instant createdAt, Instant expiresAt) {
        return SessionCreatedEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .recipient(recipient)
                .hasSecretQuestion(hasSecretQuestion)
                .createdAt(createdAt)
                .expiresAt(expiresAt)
                .build();
    }

    /**
     * Create an error event.
     *
     * @param errorCode the error code
     * @return error event
     */
    public static SessionCreatedEvent error(String errorCode) {
        return SessionCreatedEvent.builder()
                .success(false)
                .error(errorCode)
                .build();
    }
}

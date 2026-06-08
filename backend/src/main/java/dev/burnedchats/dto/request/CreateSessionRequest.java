package dev.burnedchats.dto.request;

import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for creating a new chat session.
 *
 * <p>Sent by client via STOMP to {@code /app/session.create} to initiate
 * a secure chat with another user.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "recipientInternalId": "550e8400-e29b-41d4-a716-446655440000",
 *   "recipientId": 123456789,
 *   "secretQuestion": "What was our secret code?",
 *   "secretExpectedAnswer": "Blue boat"
 * }
 * }</pre>
 *
 * <p>{@link #recipientInternalId} is the primary address key. {@link #recipientId} is
 * optional and retained for legacy Telegram clients until frontend migration (IMP-WALLETID-07).
 *
 * @see dev.burnedchats.handler.SessionHandler
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CreateSessionRequest {

    /**
     * Stable internal id (UUID) of the recipient — primary address key.
     */
    @Size(min = 36, max = 36, message = "Recipient internal id must be a UUID")
    private String recipientInternalId;

    /**
     * Legacy Telegram user ID of the recipient.
     *
     * <p>Optional when {@link #recipientInternalId} is provided. Resolved server-side
     * to internal id via {@code auth_tg:} mapping.
     *
     * @deprecated Prefer {@link #recipientInternalId}
     */
    @Deprecated
    @Positive(message = "Recipient ID must be positive")
    private Long recipientId;

    /**
     * Optional secret question for additional verification.
     *
     * <p>If provided, the recipient must answer this question
     * before they can accept the chat request.
     *
     * <p>Maximum length: 256 characters.
     */
    @Size(max = 256, message = "Secret question must not exceed 256 characters")
    private String secretQuestion;

    /**
     * Expected answer to the secret question (initiator only).
     *
     * <p>Required when {@link #secretQuestion} is present and non-blank after trim.
     * Maximum length: 256 characters (same as the question).
     * Never logged server-side.
     */
    @Size(max = 256, message = "Secret expected answer must not exceed 256 characters")
    private String secretExpectedAnswer;
}

package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotNull;
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
 *   "recipientId": 123456789,
 *   "secretQuestion": "What was our secret code?",
 *   "secretExpectedAnswer": "Blue boat"
 * }
 * }</pre>
 *
 * <p>The secretQuestion is optional. If it is non-empty after trim,
 * {@code secretExpectedAnswer} is required (same length limits). The server
 * stores only a hash of the expected answer, not the plaintext.
 *
 * @see dev.burnedchats.handler.SessionHandler
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CreateSessionRequest {

    /**
     * Telegram user ID of the recipient.
     *
     * <p>Must be a positive number representing a valid Telegram user ID.
     */
    @NotNull(message = "Recipient ID is required")
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

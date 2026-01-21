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
 *   "secretQuestion": "What was our secret code?"
 * }
 * }</pre>
 *
 * <p>The secretQuestion is optional and can be used for additional
 * verification before the recipient can accept the request.
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
}

package dev.burnedchats.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.Instant;

/**
 * Pending chat request between users.
 *
 * <p>Represents a request to start an encrypted chat session.
 * Requests have a short TTL (5 minutes) and are automatically
 * expired by Redis.
 *
 * <p>Example:
 * <pre>{@code
 * ChatRequest request = ChatRequest.builder()
 *     .sessionId("uuid-here")
 *     .senderTgId(123456789L)
 *     .senderUsername("alice")
 *     .senderFirstName("Alice")
 *     .build();
 * }</pre>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ChatRequest implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * Default request expiration time in minutes.
     */
    public static final int DEFAULT_EXPIRATION_MINUTES = 5;

    /**
     * Session ID this request belongs to.
     */
    private String sessionId;

    /**
     * Telegram user ID of the sender.
     */
    private Long senderTgId;

    /**
     * Sender's Telegram username.
     * May be null if user hasn't set a username.
     */
    private String senderUsername;

    /**
     * Sender's first name.
     */
    private String senderFirstName;

    /**
     * Sender's last name.
     * May be null.
     */
    private String senderLastName;

    /**
     * Sender's photo URL.
     * May be null.
     */
    private String senderPhotoUrl;

    /**
     * Whether this request includes a secret question.
     */
    @Builder.Default
    private boolean hasQuestion = false;

    /**
     * Optional secret question for verification.
     * Only set if hasQuestion is true.
     */
    private String question;

    /**
     * Timestamp when request was created.
     */
    @Builder.Default
    private Instant createdAt = Instant.now();

    /**
     * Telegram user ID of the recipient.
     */
    private Long recipientTgId;

    /**
     * Calculate expiration timestamp based on creation time.
     *
     * @return expiration instant
     */
    public Instant getExpiresAt() {
        return createdAt.plusSeconds(DEFAULT_EXPIRATION_MINUTES * 60L);
    }

    /**
     * Check if the request has expired.
     *
     * @return true if expired
     */
    public boolean isExpired() {
        return Instant.now().isAfter(getExpiresAt());
    }

    /**
     * Create a ChatRequest from sender's TelegramUser info.
     *
     * @param sessionId session ID
     * @param sender sender's user info
     * @param recipientTgId recipient's Telegram ID
     * @param question optional secret question
     * @return configured ChatRequest
     */
    public static ChatRequest fromSender(String sessionId, TelegramUser sender,
                                         Long recipientTgId, String question) {
        return ChatRequest.builder()
                .sessionId(sessionId)
                .senderTgId(sender.getId())
                .senderUsername(sender.getUsername())
                .senderFirstName(sender.getFirstName())
                .senderLastName(sender.getLastName())
                .senderPhotoUrl(sender.getPhotoUrl())
                .recipientTgId(recipientTgId)
                .hasQuestion(question != null && !question.isBlank())
                .question(question)
                .createdAt(Instant.now())
                .build();
    }
}

package dev.burnedchats.model;

import dev.burnedchats.util.InternalIds;
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
     * Internal id of the sender (UUID).
     */
    private String senderInternalId;

    /**
     * Telegram user ID of the sender (null for wallet-only senders).
     */
    private Long senderTgId;

    /**
     * Sender's Telegram username.
     * May be null if user hasn't set a username.
     */
    private String senderUsername;

    /**
     * Sender's first name or display name fragment.
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
     * Internal id of the recipient (UUID).
     */
    private String recipientInternalId;

    /**
     * Telegram user ID of the recipient (null for wallet-only recipients).
     *
     * @deprecated Use {@link #recipientInternalId} for queue keys and routing.
     */
    @Deprecated
    private Long recipientTgId;

    /**
     * Redis queue key recipient id — always {@link #recipientInternalId}.
     */
    public String getRecipientKey() {
        if (recipientInternalId != null && !recipientInternalId.isBlank()) {
            return recipientInternalId;
        }
        if (recipientTgId != null) {
            return InternalIds.forTelegramId(recipientTgId);
        }
        return null;
    }

    /**
     * Sender internal id for deduplication — falls back to deterministic TG mapping.
     */
    public String getSenderKey() {
        if (senderInternalId != null && !senderInternalId.isBlank()) {
            return senderInternalId;
        }
        if (senderTgId != null) {
            return InternalIds.forTelegramId(senderTgId);
        }
        return null;
    }

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
     * Create a ChatRequest from sender profile and recipient ids.
     */
    public static ChatRequest fromParticipants(String sessionId, UnifiedUser sender,
                                               String recipientInternalId, Long recipientTelegramId,
                                               String question) {
        String senderDisplay = sender.displayName() != null ? sender.displayName() : "User";
        return ChatRequest.builder()
                .sessionId(sessionId)
                .senderInternalId(sender.internalId())
                .senderTgId(sender.telegramId())
                .senderFirstName(senderDisplay)
                .senderPhotoUrl(sender.avatarUrl())
                .recipientInternalId(recipientInternalId)
                .recipientTgId(recipientTelegramId)
                .hasQuestion(question != null && !question.isBlank())
                .question(question)
                .createdAt(Instant.now())
                .build();
    }

    /**
     * Legacy factory for Telegram-only cached users.
     *
     * @deprecated Prefer {@link #fromParticipants}
     */
    @Deprecated
    public static ChatRequest fromSender(String sessionId, TelegramUser sender,
                                         Long recipientTgId, String question) {
        return ChatRequest.builder()
                .sessionId(sessionId)
                .senderInternalId(InternalIds.forTelegramId(sender.getId()))
                .senderTgId(sender.getId())
                .senderUsername(sender.getUsername())
                .senderFirstName(sender.getFirstName())
                .senderLastName(sender.getLastName())
                .senderPhotoUrl(sender.getPhotoUrl())
                .recipientInternalId(InternalIds.forTelegramId(recipientTgId))
                .recipientTgId(recipientTgId)
                .hasQuestion(question != null && !question.isBlank())
                .question(question)
                .createdAt(Instant.now())
                .build();
    }
}

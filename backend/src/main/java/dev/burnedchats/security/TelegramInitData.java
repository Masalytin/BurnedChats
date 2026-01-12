package dev.burnedchats.security;

import dev.burnedchats.model.TelegramUser;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Parsed and validated Telegram Mini App initData.
 *
 * <p>This class represents the validated authentication data from Telegram Mini App.
 * The data is extracted from the initData query string after HMAC-SHA256 validation.
 *
 * <p>Fields correspond to the Telegram Mini App WebAppInitData:
 * <ul>
 *   <li>user - The authenticated Telegram user</li>
 *   <li>authDate - Unix timestamp when the data was created</li>
 *   <li>hash - HMAC-SHA256 signature (used for validation)</li>
 *   <li>queryId - Unique query identifier for inline mode</li>
 *   <li>chatType - Type of chat from which Mini App was opened</li>
 *   <li>chatInstance - Instance identifier for the chat</li>
 *   <li>startParam - Deep link parameter passed via bot link</li>
 * </ul>
 *
 * @see <a href="https://core.telegram.org/bots/webapps#webappinitdata">WebAppInitData</a>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TelegramInitData {

    /**
     * The authenticated Telegram user.
     * Contains id, username, firstName, lastName, etc.
     */
    private TelegramUser user;

    /**
     * Unix timestamp when the data was created by Telegram.
     * Used to check data freshness.
     */
    private Instant authDate;

    /**
     * HMAC-SHA256 hash of the data-check-string.
     * Used to verify data authenticity.
     */
    private String hash;

    /**
     * Unique identifier for inline query.
     * Present only if Mini App was opened via inline mode.
     */
    private String queryId;

    /**
     * Type of chat from which Mini App was opened.
     * Can be: "sender", "private", "group", "supergroup", "channel".
     */
    private String chatType;

    /**
     * Global identifier for the chat instance.
     * Useful for distinguishing between different chats.
     */
    private String chatInstance;

    /**
     * Deep link parameter passed via bot link.
     * E.g., from t.me/BotUsername/AppName?startapp=param
     */
    private String startParam;

    /**
     * Whether the user can send messages (in groups).
     */
    private Boolean canSendAfter;

    /**
     * Get user's Telegram ID.
     *
     * @return Telegram user ID or null if user is not set
     */
    public Long getUserId() {
        return user != null ? user.getId() : null;
    }

    /**
     * Get user's username.
     *
     * @return username without @ or null if not set
     */
    public String getUsername() {
        return user != null ? user.getUsername() : null;
    }

    /**
     * Check if auth data is older than the specified duration.
     *
     * @param maxAgeSeconds maximum allowed age in seconds
     * @return true if data is expired
     */
    public boolean isExpired(int maxAgeSeconds) {
        if (authDate == null) {
            return true;
        }
        Instant expirationTime = authDate.plusSeconds(maxAgeSeconds);
        return Instant.now().isAfter(expirationTime);
    }
}

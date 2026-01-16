package dev.burnedchats.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.Instant;

/**
 * Cached Telegram user information.
 *
 * <p>This model stores basic user data from Telegram for display purposes.
 * The data is cached in Redis with TTL to reduce API calls.
 *
 * <p>Example usage with Lombok:
 * <pre>{@code
 * TelegramUser user = TelegramUser.builder()
 *     .id(123456789L)
 *     .username("johndoe")
 *     .firstName("John")
 *     .lastName("Doe")
 *     .build();
 * }</pre>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TelegramUser implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * Telegram user ID (unique identifier).
     */
    private Long id;

    /**
     * Telegram username (without @).
     * May be null if user hasn't set a username.
     */
    private String username;

    /**
     * User's first name.
     */
    private String firstName;

    /**
     * User's last name.
     * May be null.
     */
    private String lastName;

    /**
     * User's language code (e.g., "en", "ru").
     * May be null.
     */
    private String languageCode;

    /**
     * URL to user's profile photo.
     * May be null if user has no photo.
     */
    private String photoUrl;

    /**
     * Whether this user is a Telegram Premium subscriber.
     */
    @Builder.Default
    private boolean isPremium = false;

    /**
     * Timestamp when this user data was cached.
     */
    @Builder.Default
    private Instant cachedAt = Instant.now();

    /**
     * Get display name (firstName + lastName or username).
     *
     * @return display name for UI
     */
    public String getDisplayName() {
        if (firstName != null) {
            return lastName != null
                    ? firstName + " " + lastName
                    : firstName;
        }
        return username != null ? "@" + username : "User " + id;
    }
}




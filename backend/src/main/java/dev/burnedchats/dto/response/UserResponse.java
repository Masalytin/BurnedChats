package dev.burnedchats.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * User information response DTO.
 *
 * <p>Used to send user data to clients. Contains only safe,
 * public information.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserResponse {

    /**
     * Stable internal identity id (UUID string). Primary address key for DM/rooms.
     */
    private String internalId;

    /**
     * Telegram user ID (null for wallet-only users).
     */
    private Long id;

    /**
     * Username (without @).
     */
    private String username;

    /**
     * Display name (first + last name).
     */
    private String displayName;

    /**
     * Profile photo URL (if available).
     */
    private String photoUrl;

    /**
     * Whether user is currently online.
     */
    private boolean online;

    /**
     * Whether user is a Premium subscriber.
     */
    private boolean premium;
}




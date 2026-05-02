package dev.burnedchats.model;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.security.TelegramInitData;

/**
 * Unified identity model used across authentication providers.
 */
public record UnifiedUser(
        String internalId,
        AuthType authType,
        String displayName,
        Long telegramId,
        String walletAddress,
        String avatarUrl
) {
    public static UnifiedUser fromTelegram(TelegramInitData data, String internalId) {
        Long userId = data.getUserId();
        if (userId == null) {
            throw new AuthenticationException("Telegram user id missing from init data");
        }
        String displayName = data.getUser() != null ? data.getUser().getDisplayName() : ("User " + userId);
        String avatarUrl = data.getUser() != null ? data.getUser().getPhotoUrl() : null;
        return new UnifiedUser(
                internalId,
                AuthType.TELEGRAM,
                displayName,
                userId,
                null,
                avatarUrl);
    }
}

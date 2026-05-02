package dev.burnedchats.security;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.model.enums.AuthType;

/**
 * Provider-agnostic authenticated identity returned by {@link AuthenticationService}.
 *
 * <p>For Telegram sessions, {@link #telegramInitData()} carries the validated init payload.
 * Wallet strategies will omit it once implemented.
 *
 * @param authType           authentication provider
 * @param subjectId          stable subject id within that provider (e.g. Telegram user id as string for now)
 * @param displayName        human-readable name for logs and transitional UI mappings
 * @param telegramInitData   non-null only for Telegram auth
 */
public record UnifiedUser(
        AuthType authType,
        String subjectId,
        String displayName,
        TelegramInitData telegramInitData
) {

    /**
     * Map validated Telegram Mini App {@link TelegramInitData} into a unified user.
     *
     * @param data validated init data including user id
     * @return unified user with Telegram context populated
     */
    public static UnifiedUser fromTelegram(TelegramInitData data) {
        Long userId = data.getUserId();
        if (userId == null) {
            throw new AuthenticationException("Telegram user id missing from init data");
        }
        String displayName = data.getUser() != null ? data.getUser().getDisplayName() : ("User " + userId);
        return new UnifiedUser(AuthType.TELEGRAM, String.valueOf(userId), displayName, data);
    }
}

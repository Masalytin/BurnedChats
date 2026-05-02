package dev.burnedchats.util;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Utilities for stable internal identity ids.
 */
public final class InternalIds {
    private InternalIds() {
    }

    public static String forTelegramId(Long telegramId) {
        if (telegramId == null) {
            throw new IllegalArgumentException("telegramId cannot be null");
        }
        return UUID.nameUUIDFromBytes(("burnedchats:telegram:" + telegramId).getBytes(StandardCharsets.UTF_8))
                .toString();
    }
}

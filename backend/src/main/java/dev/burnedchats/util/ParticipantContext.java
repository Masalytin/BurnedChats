package dev.burnedchats.util;

import dev.burnedchats.security.AppPrincipal;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;

import java.security.Principal;

/**
 * Authenticated participant identity resolved from a STOMP {@link Principal}.
 *
 * <p>{@link #telegramId()}, {@link #username()}, and {@link #firstName()} are populated
 * only for {@link TelegramPrincipal}; wallet principals expose {@link #internalId()} only.
 */
public record ParticipantContext(
        String internalId,
        Long telegramId,
        String username,
        String firstName
) {

    /**
     * Resolves participant context from any {@link AppPrincipal}, or {@code null} when unsupported.
     */
    public static ParticipantContext from(Principal principal) {
        if (!(principal instanceof AppPrincipal appPrincipal)) {
            return null;
        }
        Long telegramId = null;
        String username = null;
        String firstName = null;
        if (principal instanceof TelegramPrincipal telegramPrincipal) {
            telegramId = telegramPrincipal.getUserId();
            username = telegramPrincipal.getUsername();
            firstName = telegramPrincipal.getFirstName();
        }
        return new ParticipantContext(
                appPrincipal.getInternalId(),
                telegramId,
                username,
                firstName
        );
    }
}

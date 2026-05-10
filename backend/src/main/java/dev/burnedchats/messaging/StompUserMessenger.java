package dev.burnedchats.messaging;

import dev.burnedchats.security.AppPrincipal;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.security.Principal;

/**
 * Single entry point for server-initiated messages to STOMP user destinations ({@code /user/queue/...}).
 *
 * <p><strong>Contract:</strong> Spring resolves {@code convertAndSendToUser(username, ...)} by matching
 * {@code username} to {@link Principal#getName()} for active sessions. In this project that name is always
 * {@link dev.burnedchats.model.UnifiedUser#internalId()}, not Telegram ID. Prefer
 * {@link #convertAndSendToUser(AppPrincipal, String, Object)} or
 * {@link #convertAndSendToInternalId(String, String, Object)} — never {@code String.valueOf(telegramId)}.
 *
 * @see AppPrincipal
 */
@Component
@RequiredArgsConstructor
public class StompUserMessenger {

    private final SimpMessagingTemplate messagingTemplate;

    /**
     * Sends a payload to the given authenticated user's personal queue.
     *
     * @param principal authenticated app principal (Telegram or wallet)
     * @param destination destination suffix (e.g. {@code "/queue/room-created"})
     * @param payload     message body
     */
    public void convertAndSendToUser(AppPrincipal principal, String destination, Object payload) {
        messagingTemplate.convertAndSendToUser(principal.getInternalId(), destination, payload);
    }

    /**
     * Like {@link #convertAndSendToUser(AppPrincipal, String, Object)} but accepts a raw {@link Principal}
     * from handler signatures.
     *
     * @throws IllegalArgumentException if {@code principal} is not an {@link AppPrincipal}
     */
    public void convertAndSendToUserPrincipal(Principal principal, String destination, Object payload) {
        if (!(principal instanceof AppPrincipal appPrincipal)) {
            throw new IllegalArgumentException(
                    "Principal must implement AppPrincipal for STOMP user routing; got: "
                            + (principal == null ? "null" : principal.getClass().getName()));
        }
        convertAndSendToUser(appPrincipal, destination, payload);
    }

    /**
     * Sends to a user queue by internal id when no {@link Principal} is available (e.g. server fan-out).
     *
     * @param internalId  {@link dev.burnedchats.model.UnifiedUser#internalId()}
     * @param destination destination suffix
     * @param payload     message body
     */
    public void convertAndSendToInternalId(String internalId, String destination, Object payload) {
        messagingTemplate.convertAndSendToUser(internalId, destination, payload);
    }
}

package dev.burnedchats.security;

import dev.burnedchats.model.UnifiedUser;

import java.security.Principal;

/**
 * Application principal whose {@linkplain #getName() name} and {@link #getInternalId()}
 * identify the same stable user key used by Spring for STOMP user destinations.
 *
 * <p>After identity migration ({@code P3-1-1-2}), {@link Principal#getName()} on WebSocket
 * sessions returns {@link UnifiedUser#internalId()} (a UUID string). That value is the
 * only valid {@code username} argument for {@code SimpMessagingTemplate#convertAndSendToUser}.
 * Telegram numeric ID and similar domain identifiers must never be used for that call.
 *
 * <p>Handlers should send user-targeted STOMP events through
 * {@link dev.burnedchats.messaging.StompUserMessenger} so routing stays consistent
 * (see project docs / IMP-STOMP-USERDEST-*).
 *
 * @see StompAuthInterceptor.TelegramPrincipal
 * @see StompAuthInterceptor.WalletPrincipal
 * @see dev.burnedchats.messaging.StompUserMessenger
 */
public interface AppPrincipal extends Principal {

    /**
     * Stable internal user id from {@link UnifiedUser#internalId()}; must equal {@link #getName()}.
     *
     * @return non-null internal id string
     */
    String getInternalId();
}

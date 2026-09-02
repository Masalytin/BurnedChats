package dev.burnedchats.handler;

import dev.burnedchats.security.AppPrincipal;
import dev.burnedchats.service.PresenceService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;

import java.security.Principal;

/**
 * STOMP handler for client heartbeat / presence refresh.
 *
 * <p>The server tracks presence in Redis with a 30-second TTL for UI
 * ({@code online:*}). Clients send a heartbeat every 20 seconds to
 * keep that key alive. DM immediate delivery is gated on a live
 * STOMP session ({@code SimpUserRegistry}), not this TTL.
 *
 * <p>Destinations:
 * <ul>
 *   <li>{@code /app/heartbeat} — refresh presence TTL</li>
 *   <li>{@code /app/presence.offline} — explicit offline (Mini App cleanup)</li>
 * </ul>
 *
 * @see PresenceService
 */
@Slf4j
@Controller
@RequiredArgsConstructor
public class HeartbeatHandler {

    private final PresenceService presenceService;

    /**
     * Handle heartbeat from client to refresh presence TTL in Redis.
     *
     * <p>Called periodically by the client (every ~20 seconds) to keep
     * {@code online:*} alive for presence UI. Does not gate DM delivery.
     *
     * @param principal authenticated user principal
     */
    @MessageMapping("/heartbeat")
    public void heartbeat(Principal principal) {
        if (!(principal instanceof AppPrincipal appPrincipal)) {
            LOG.warn("Heartbeat from unsupported principal type: {}",
                    principal != null ? principal.getClass().getName() : "null");
            return;
        }

        String internalId = appPrincipal.getInternalId();

        presenceService.markOnline(internalId)
                .doOnSuccess(unused -> LOG.trace("Heartbeat received: internalId={}", internalId))
                .subscribe(
                        unused -> { },
                        error -> LOG.warn("Failed to process heartbeat for user {}: {}",
                                internalId, error.getMessage())
            );
    }

    /**
     * Explicitly mark the caller offline in Redis.
     *
     * <p>Used by Mini App cleanup when {@code pagehide} fires, including the
     * case with no active DM session keys. Best-effort: a kill without
     * {@code pagehide} is covered by the live-STOMP delivery gate, not this
     * mapping.
     *
     * @param principal authenticated user principal
     */
    @MessageMapping("/presence.offline")
    public void markOffline(Principal principal) {
        if (!(principal instanceof AppPrincipal appPrincipal)) {
            LOG.warn("presence.offline from unsupported principal type: {}",
                    principal != null ? principal.getClass().getName() : "null");
            return;
        }

        String internalId = appPrincipal.getInternalId();

        presenceService.markOffline(internalId)
                .doOnSuccess(unused -> LOG.debug("User marked offline: internalId={}", internalId))
                .subscribe(
                        unused -> { },
                        error -> LOG.warn("Failed to mark user offline {}: {}",
                                internalId, error.getMessage())
            );
    }
}

package dev.burnedchats.handler;

import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.security.AppPrincipal;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;

import java.security.Principal;

/**
 * STOMP handler for client heartbeat / presence refresh.
 *
 * <p>The server tracks online status in Redis with a 30-second TTL.
 * Clients must send a heartbeat every 20 seconds to keep their
 * status alive. Without this, the Redis key expires and the user
 * is considered offline — messages will be queued and Telegram
 * notifications sent instead of real-time delivery.
 *
 * <p>Destination:
 * <ul>
 *   <li>{@code /app/heartbeat} — refresh online status TTL</li>
 * </ul>
 *
 * @see OnlineStatusRepository
 */
@Slf4j
@Controller
@RequiredArgsConstructor
public class HeartbeatHandler {

    private final OnlineStatusRepository onlineStatusRepository;

    /**
     * Handle heartbeat from client to refresh online status TTL in Redis.
     *
     * <p>Called periodically by the client (every ~20 seconds) to indicate
     * the user is still actively connected and should receive real-time
     * message delivery.
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

        onlineStatusRepository.setOnline(internalId)
                .subscribe(
                        result -> LOG.trace("Heartbeat received: internalId={}", internalId),
                        error -> LOG.warn("Failed to process heartbeat for user {}: {}",
                                internalId, error.getMessage())
            );
    }
}

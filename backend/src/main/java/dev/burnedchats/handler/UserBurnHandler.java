package dev.burnedchats.handler;

import dev.burnedchats.dto.event.BurnAllCompleteEvent;
import dev.burnedchats.dto.request.BurnAllRequest;
import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.security.AppPrincipal;
import dev.burnedchats.service.RateLimitService;
import dev.burnedchats.service.UserBurnService;
import dev.burnedchats.util.ParticipantContext;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Controller;
import org.springframework.validation.annotation.Validated;
import reactor.core.publisher.Mono;

import java.security.Principal;
import java.time.Duration;

/**
 * STOMP handler for global user burn-all cascade.
 */
@Slf4j
@Controller
@RequiredArgsConstructor
@Validated
public class UserBurnHandler {

    private static final String BURN_ALL_COMPLETE_DESTINATION = "/queue/burn-all-complete";
    private static final int BURN_ALL_MAX_REQUESTS = 3;
    private static final Duration BURN_ALL_WINDOW = Duration.ofMinutes(1);

    private final UserBurnService userBurnService;
    private final RateLimitService rateLimitService;
    private final StompUserMessenger stompUserMessenger;

    @MessageMapping("/user.burnAll")
    public void burnAll(@Payload @Valid BurnAllRequest request, Principal principal) {
        ParticipantContext participant = ParticipantContext.from(principal);
        if (participant == null) {
            LOG.warn("user.burnAll: unsupported principal type {}",
                    principal != null ? principal.getClass().getName() : "null");
            return;
        }

        boolean wipeIdentity = Boolean.TRUE.equals(request.isWipeIdentity());
        LOG.info("Burn-all requested: internalId={}, wipeIdentity={}",
                participant.internalId(), wipeIdentity);

        rateLimitService.checkRestRateLimit(
                        "burn_all",
                        participant.internalId(),
                        BURN_ALL_MAX_REQUESTS,
                        BURN_ALL_WINDOW)
                .then(Mono.defer(() -> userBurnService.burnAllForUser(participant.internalId(), wipeIdentity)))
                .subscribe(
                        summary -> {
                            BurnAllCompleteEvent event = BurnAllCompleteEvent.from(summary);
                            if (principal instanceof AppPrincipal appPrincipal) {
                                stompUserMessenger.convertAndSendToUser(
                                        appPrincipal, BURN_ALL_COMPLETE_DESTINATION, event);
                            } else {
                                stompUserMessenger.convertAndSendToInternalId(
                                        participant.internalId(), BURN_ALL_COMPLETE_DESTINATION, event);
                            }
                            LOG.info("Burn-all completed: internalId={}, sessions={}, rooms={}, left={}, wipeIdentity={}",
                                    participant.internalId(),
                                    summary.burnedSessions(),
                                    summary.burnedRooms(),
                                    summary.leftRooms(),
                                    summary.wipeIdentity());
                        },
                        error -> {
                            if (error instanceof RateLimitException) {
                                LOG.warn("Burn-all rate limited: internalId={}", participant.internalId());
                                return;
                            }
                            LOG.error("Burn-all failed: internalId={}, error={}",
                                    participant.internalId(), error.getMessage());
                        }
                );
    }
}

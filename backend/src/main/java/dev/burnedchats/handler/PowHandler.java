package dev.burnedchats.handler;

import dev.burnedchats.dto.event.PowChallengeEvent;
import dev.burnedchats.security.AppPrincipal;
import dev.burnedchats.security.pow.AdaptiveDifficultyService;
import dev.burnedchats.security.pow.PowAction;
import dev.burnedchats.security.pow.PowChallengeService;
import dev.burnedchats.messaging.StompUserMessenger;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Controller;
import org.springframework.validation.annotation.Validated;

import java.security.Principal;

/**
 * STOMP handler for PoW challenge issuance (DESIGN.md §3.1).
 *
 * <p>Destination: {@code /app/pow.challenge}
 * <p>Response: {@code /user/queue/pow-challenge}
 */
@Slf4j
@Controller
@RequiredArgsConstructor
@Validated
public class PowHandler {

    private static final String POW_CHALLENGE_DESTINATION = "/queue/pow-challenge";

    private final AdaptiveDifficultyService adaptiveDifficultyService;
    private final PowChallengeService powChallengeService;
    private final StompUserMessenger stompUserMessenger;

    @MessageMapping("/pow.challenge")
    public void requestChallenge(@Payload PowChallengeRequest request, Principal principal) {
        if (!(principal instanceof AppPrincipal appPrincipal)) {
            LOG.warn("PoW challenge rejected: unsupported principal type {}",
                    principal == null ? "null" : principal.getClass().getName());
            return;
        }

        if (request == null || request.action() == null || request.action().isBlank()) {
            LOG.debug("PoW challenge rejected: missing action internalId={}",
                    appPrincipal.getInternalId());
            return;
        }

        final PowAction action;
        try {
            action = PowAction.fromWireValue(request.action().trim());
        } catch (IllegalArgumentException e) {
            LOG.debug("PoW challenge rejected: unknown action '{}' internalId={}",
                    request.action(), appPrincipal.getInternalId());
            return;
        }

        LOG.debug("PoW challenge requested: action={}, internalId={}", action, appPrincipal.getInternalId());

        adaptiveDifficultyService.currentDifficulty(action)
                .flatMap(difficulty -> powChallengeService.issue(action, difficulty))
                .subscribe(
                        event -> sendChallenge(appPrincipal, event),
                        error -> LOG.error("Failed to issue PoW challenge for internalId={}: {}",
                                appPrincipal.getInternalId(), error.getMessage())
                );
    }

    private void sendChallenge(AppPrincipal principal, PowChallengeEvent event) {
        stompUserMessenger.convertAndSendToUser(principal, POW_CHALLENGE_DESTINATION, event);
        LOG.trace("Sent PoW challenge to internalId={}: action={}, difficulty={}",
                principal.getInternalId(), event.getAction(), event.getDifficulty());
    }

    /**
     * STOMP body for {@code /app/pow.challenge}.
     *
     * @param action wire-format PoW action (e.g. {@code session_create})
     */
    public record PowChallengeRequest(String action) {
    }
}

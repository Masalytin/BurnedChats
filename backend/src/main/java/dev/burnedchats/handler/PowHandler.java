package dev.burnedchats.handler;

import dev.burnedchats.dto.event.PowChallengeEvent;
import dev.burnedchats.exception.BurnedChatsException;
import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.security.AppPrincipal;
import dev.burnedchats.security.pow.AdaptiveDifficultyService;
import dev.burnedchats.security.pow.PowAction;
import dev.burnedchats.security.pow.PowChallengeService;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.service.RateLimitService;
import dev.burnedchats.service.RateLimitService.RateLimitType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Controller;
import org.springframework.validation.annotation.Validated;
import reactor.core.publisher.Mono;

import java.security.Principal;
import java.util.Map;

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
    private static final String ERRORS_DESTINATION = "/queue/errors";

    private final AdaptiveDifficultyService adaptiveDifficultyService;
    private final PowChallengeService powChallengeService;
    private final RateLimitService rateLimitService;
    private final StompUserMessenger stompUserMessenger;
    private final WebSocketExceptionHandler webSocketExceptionHandler;

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

        rateLimitService.enforceRateLimit(appPrincipal.getInternalId(), RateLimitType.POW_CHALLENGE)
                .then(Mono.defer(() -> issueIfAllowed(action)))
                .subscribe(
                        event -> sendChallenge(appPrincipal, event),
                        error -> handleChallengeFailure(appPrincipal, error));
    }

    private Mono<PowChallengeEvent> issueIfAllowed(PowAction action) {
        if (!action.isIssued()) {
            return Mono.error(new BurnedChatsException(
                    "PoW challenge is not issued for action: " + action.wireValue(),
                    "VALIDATION_ERROR"));
        }
        return adaptiveDifficultyService.currentDifficulty(action)
                .flatMap(difficulty -> powChallengeService.issue(action, difficulty));
    }

    private void handleChallengeFailure(AppPrincipal principal, Throwable error) {
        Throwable root = error;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }

        if (root instanceof RateLimitException rateLimitException) {
            Map<String, Object> payload = webSocketExceptionHandler.handleRateLimitException(rateLimitException);
            stompUserMessenger.convertAndSendToUser(principal, ERRORS_DESTINATION, payload);
            return;
        }

        if (root instanceof BurnedChatsException burnedChatsException
                && "VALIDATION_ERROR".equals(burnedChatsException.getErrorCode())) {
            Map<String, Object> payload =
                    webSocketExceptionHandler.handleBurnedChatsException(burnedChatsException);
            stompUserMessenger.convertAndSendToUser(principal, ERRORS_DESTINATION, payload);
            return;
        }

        LOG.error("Failed to issue PoW challenge for internalId={}: {}",
                principal.getInternalId(), root.getMessage());
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

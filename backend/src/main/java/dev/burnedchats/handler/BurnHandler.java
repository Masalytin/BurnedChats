package dev.burnedchats.handler;

import dev.burnedchats.dto.event.BurnSignalEvent;
import dev.burnedchats.dto.request.BurnSessionRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.repository.MessageRepository;
import dev.burnedchats.repository.RequestRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.service.FileBurnService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Controller;
import org.springframework.util.StringUtils;
import org.springframework.validation.annotation.Validated;
import reactor.core.publisher.Mono;

import java.security.Principal;
import java.time.Instant;
import java.util.List;

/**
 * STOMP handler for session burn (destruction) operations.
 *
 * <p>Handles the complete destruction of a chat session, including:
 * <ul>
 *   <li>Updating session status to BURNED</li>
 *   <li>Deleting all session data from Redis</li>
 *   <li>Deleting all queued messages</li>
 *   <li>Deleting any pending requests</li>
 *   <li>Notifying both participants via BURN_SIGNAL</li>
 * </ul>
 *
 * <p>Either participant can burn a session at any time. The burn operation
 * is immediate and irreversible - all server-side data is permanently deleted.
 *
 * <p>Destinations:
 * <ul>
 *   <li>{@code /app/session.burn} - burn (destroy) a session</li>
 * </ul>
 *
 * <p>Events sent:
 * <ul>
 *   <li>{@code /user/queue/burn-signal} - sent to both participants</li>
 * </ul>
 *
 * <p>Security notes:
 * <ul>
 *   <li>Only session participants can burn a session</li>
 *   <li>Session must be in PENDING, HANDSHAKE, or ACTIVE status</li>
 *   <li>Already burned sessions return ALREADY_BURNED error</li>
 *   <li>All data is permanently deleted from Redis</li>
 * </ul>
 *
 * @see BurnSessionRequest
 * @see BurnSignalEvent
 */
@Slf4j
@Controller
@RequiredArgsConstructor
@Validated
public class BurnHandler {

    /**
     * STOMP destination for burn signal events (sent to both participants).
     */
    private static final String BURN_SIGNAL_DESTINATION = "/queue/burn-signal";

    private final SessionRepository sessionRepository;
    private final MessageRepository messageRepository;
    private final RequestRepository requestRepository;
    private final StompUserMessenger stompUserMessenger;
    private final UserIdentityRepository userIdentityRepository;
    private final FileBurnService fileBurnService;

    /**
     * Burn (destroy) a chat session.
     *
     * <p>Flow:
     * <ol>
     *   <li>Validate session exists</li>
     *   <li>Validate user is a participant</li>
     *   <li>Validate session is not already burned</li>
     *   <li>Update session status to BURNED</li>
     *   <li>Delete all queued messages for both participants</li>
     *   <li>Delete any pending requests</li>
     *   <li>Delete session data from Redis</li>
     *   <li>Send BURN_SIGNAL to both participants</li>
     * </ol>
     *
     * <p>This operation is irreversible. After burning:
     * <ul>
     *   <li>The session cannot be resumed or recovered</li>
     *   <li>All messages are permanently lost</li>
     *   <li>Clients must destroy all local cryptographic material</li>
     * </ul>
     *
     * @param request   the burn session request payload
     * @param principal authenticated user principal
     */
    @MessageMapping("/session.burn")
    public void burnSession(@Payload BurnSessionRequest request, Principal principal) {
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long userId = telegramPrincipal.getUserId();
        String sessionId = request.getSessionId();

        LOG.info("Session burn requested: sessionId={}, userId={}", sessionId, userId);

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Session not found for burn: {}", sessionId);
                    sendBurnError(telegramPrincipal, sessionId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> validateAndBurnSession(session, telegramPrincipal))
                .subscribe(
                        result -> {},
                        error -> {
                            LOG.error("Error burning session {}: {}", sessionId, error.getMessage());
                            sendBurnError(telegramPrincipal, sessionId, "INTERNAL_ERROR");
                        }
            );
    }

    /**
     * Validate session state and perform the burn operation.
     */
    private Mono<Void> validateAndBurnSession(Session session, TelegramPrincipal principal) {
        Long userId = principal.getUserId();
        String sessionId = session.getId();

        // Validate user is a participant
        if (!session.isParticipant(userId)) {
            LOG.debug("User {} is not a participant in session {}", userId, sessionId);
            sendBurnError(principal, sessionId, "NOT_PARTICIPANT");
            return Mono.empty();
        }

        // Validate session status - cannot burn already burned sessions
        if (session.getStatus() == SessionStatus.BURNED) {
            LOG.debug("Session {} is already burned", sessionId);
            sendBurnError(principal, sessionId, "ALREADY_BURNED");
            return Mono.empty();
        }

        // Perform the burn operation
        return doBurnSession(session, userId);
    }

    /**
     * Execute the burn operation - delete all data and notify participants.
     *
     * <p>Task 4.4.2: Redis cleanup includes:
     * <ul>
     *   <li>Session hash data</li>
     *   <li>Queued messages for both participants</li>
     *   <li>Any pending requests in either participant's queue</li>
     * </ul>
     */
    private Mono<Void> doBurnSession(Session session, Long burningUserId) {
        String sessionId = session.getId();
        Long initiatorId = session.getInitiatorId();
        Long responderId = session.getResponderId();
        Instant burnedAt = Instant.now();

        LOG.info("Burning session: sessionId={}, initiator={}, responder={}, burnedBy={}",
                sessionId, initiatorId, responderId, burningUserId);

        // First update status to BURNED (prevents race conditions)
        return sessionRepository.updateStatus(sessionId, SessionStatus.BURNED)
                // Delete associated files from storage first (burn cascade P4-3-1-3)
                .then(fileBurnService.deleteFilesForContext(sessionId))
                // Then delete all related data in parallel
                .then(cleanupRedisData(sessionId, initiatorId, responderId))
                // Finally delete the session itself
                .then(sessionRepository.delete(sessionId))
                // Send burn signal to both participants
                .doOnSuccess(deleted -> {
                    sendBurnSignalToBothParticipants(sessionId, initiatorId, responderId, 
                            burningUserId, burnedAt);
                    LOG.info("Session burned successfully: sessionId={}, burnedBy={}", 
                            sessionId, burningUserId);
                })
                .then();
    }

    /**
     * Clean up all Redis data associated with the session.
     *
     * <p>Deletes:
     * <ul>
     *   <li>Queued messages for initiator</li>
     *   <li>Queued messages for responder</li>
     *   <li>Any pending request from initiator to responder</li>
     *   <li>Any pending request from responder to initiator</li>
     * </ul>
     *
     * @param sessionId   the session ID
     * @param initiatorId the initiator's user ID
     * @param responderId the responder's user ID
     * @return Mono that completes when all data is deleted
     */
    private Mono<Void> cleanupRedisData(String sessionId, Long initiatorId, Long responderId) {
        List<Long> participantIds = List.of(initiatorId, responderId);

        return Mono.when(
                // Delete queued messages for both participants
                messageRepository.deleteAllForSession(sessionId, participantIds)
                        .doOnSuccess(count -> LOG.debug("Deleted {} messages for session {}", 
                                count, sessionId)),
                
                // Delete any pending requests (in case session was in PENDING status)
                requestRepository.delete(responderId, sessionId)
                        .doOnSuccess(deleted -> {
                            if (deleted) {
                                LOG.debug("Deleted pending request for responder {}", responderId);
                            }
                        }),
                
                // Also check for reverse request (edge case)
                requestRepository.delete(initiatorId, sessionId)
                        .doOnSuccess(deleted -> {
                            if (deleted) {
                                LOG.debug("Deleted pending request for initiator {}", initiatorId);
                            }
                        })
        );
    }

    /**
     * Send BURN_SIGNAL event to both session participants.
     *
     * <p>Task 4.4.3: Both participants receive the same event, which includes:
     * <ul>
     *   <li>The session ID that was burned</li>
     *   <li>Who initiated the burn</li>
     *   <li>When the burn occurred</li>
     * </ul>
     *
     * <p>Upon receiving this event, clients MUST:
     * <ul>
     *   <li>Destroy all cryptographic keys</li>
     *   <li>Clear message history from memory</li>
     *   <li>Display burn confirmation UI</li>
     * </ul>
     *
     * @param sessionId   the session ID that was burned
     * @param initiatorId the initiator's user ID
     * @param responderId the responder's user ID
     * @param burnedBy    the user ID who initiated the burn
     * @param burnedAt    timestamp when the burn occurred
     */
    private void sendBurnSignalToBothParticipants(String sessionId, Long initiatorId,
            Long responderId, Long burnedBy, Instant burnedAt) {
        BurnSignalEvent event = BurnSignalEvent.success(sessionId, burnedBy, burnedAt);

        sendBurnSignalToTelegramUser(initiatorId, event);
        sendBurnSignalToTelegramUser(responderId, event);
    }

    private void sendBurnSignalToTelegramUser(Long participantTelegramId, BurnSignalEvent event) {
        userIdentityRepository.findByTelegramId(participantTelegramId)
                .filter(StringUtils::hasText)
                .doOnNext(participantInternalId -> {
                    stompUserMessenger.convertAndSendToInternalId(
                            participantInternalId, BURN_SIGNAL_DESTINATION, event);
                    LOG.debug("Sent burn signal: participantTelegramId={}, participantInternalId={}",
                            participantTelegramId, participantInternalId);
                })
                .switchIfEmpty(Mono.fromRunnable(() -> LOG.warn(
                        "BURN_SIGNAL skipped: no UserIdentity for participantTelegramId={}, sessionId={}",
                        participantTelegramId, event.getSessionId())))
                .subscribe();
    }

    /**
     * Send burn error event to the requesting user.
     *
     * @param principal authenticated user to receive the error
     * @param sessionId the session ID that failed to burn
     * @param errorCode the error code describing the failure
     */
    private void sendBurnError(TelegramPrincipal principal, String sessionId, String errorCode) {
        BurnSignalEvent event = BurnSignalEvent.error(sessionId, errorCode);

        stompUserMessenger.convertAndSendToUser(principal, BURN_SIGNAL_DESTINATION, event);

        LOG.trace("Sent burn error: userTelegramId={}, internalId={}, code={}",
                principal.getUserId(), principal.getInternalId(), errorCode);
    }
}

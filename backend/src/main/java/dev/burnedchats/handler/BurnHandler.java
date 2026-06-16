package dev.burnedchats.handler;

import dev.burnedchats.dto.event.BurnSignalEvent;
import dev.burnedchats.dto.request.BurnSessionRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.repository.MessageRepository;
import dev.burnedchats.repository.RequestRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.util.ParticipantContext;
import dev.burnedchats.service.FileBurnService;
import jakarta.validation.Valid;
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
import java.util.ArrayList;
import java.util.List;

/**
 * STOMP handler for session burn (destruction) operations.
 *
 * @see BurnSessionRequest
 * @see BurnSignalEvent
 */
@Slf4j
@Controller
@RequiredArgsConstructor
@Validated
public class BurnHandler {

    private static final String BURN_SIGNAL_DESTINATION = "/queue/burn-signal";

    private final SessionRepository sessionRepository;
    private final MessageRepository messageRepository;
    private final RequestRepository requestRepository;
    private final StompUserMessenger stompUserMessenger;
    private final FileBurnService fileBurnService;

    @MessageMapping("/session.burn")
    public void burnSession(@Payload @Valid BurnSessionRequest request, Principal principal) {
        ParticipantContext participant = ParticipantContext.from(principal);
        if (participant == null) {
            LOG.warn("session.burn: unsupported principal type {}", principal.getClass().getName());
            return;
        }
        String sessionId = request.getSessionId();

        LOG.info("Session burn requested: sessionId={}, internalId={}", sessionId, participant.internalId());

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Session not found for burn: {}", sessionId);
                    sendBurnError(participant, sessionId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> validateAndBurnSession(session, participant))
                .subscribe(
                        result -> { },
                        error -> {
                            LOG.error("Error burning session {}: {}", sessionId, error.getMessage());
                            sendBurnError(participant, sessionId, "INTERNAL_ERROR");
                        }
            );
    }

    private Mono<Void> validateAndBurnSession(Session session, ParticipantContext participant) {
        String sessionId = session.getId();

        if (!session.isParticipant(participant.internalId())) {
            LOG.debug("User {} is not a participant in session {}",
                    participant.internalId(), sessionId);
            sendBurnError(participant, sessionId, "NOT_PARTICIPANT");
            return Mono.empty();
        }

        if (session.getStatus() == SessionStatus.BURNED) {
            LOG.debug("Session {} is already burned", sessionId);
            sendBurnError(participant, sessionId, "ALREADY_BURNED");
            return Mono.empty();
        }

        return doBurnSession(session, participant);
    }

    private Mono<Void> doBurnSession(Session session, ParticipantContext burningParticipant) {
        String sessionId = session.getId();
        String initiatorInternalId = session.getInitiatorInternalId();
        String responderInternalId = session.getResponderInternalId();
        Instant burnedAt = Instant.now();

        LOG.info("Burning session: sessionId={}, initiator={}, responder={}, burnedBy={}",
                sessionId, initiatorInternalId, responderInternalId, burningParticipant.internalId());

        return sessionRepository.updateStatus(sessionId, SessionStatus.BURNED)
                .then(fileBurnService.deleteFilesForContext(sessionId))
                .then(cleanupRedisData(sessionId, initiatorInternalId, responderInternalId))
                .then(sessionRepository.delete(sessionId))
                .doOnSuccess(deleted -> {
                    sendBurnSignalToBothParticipants(
                            sessionId, initiatorInternalId, responderInternalId,
                            burningParticipant.telegramId(), burnedAt);
                    LOG.info("Session burned successfully: sessionId={}, burnedByInternalId={}",
                            sessionId, burningParticipant.internalId());
                })
                .then();
    }

    private Mono<Void> cleanupRedisData(String sessionId, String initiatorInternalId,
            String responderInternalId) {
        List<String> participantInternalIds = new ArrayList<>();
        if (StringUtils.hasText(initiatorInternalId)) {
            participantInternalIds.add(initiatorInternalId);
        }
        if (StringUtils.hasText(responderInternalId)) {
            participantInternalIds.add(responderInternalId);
        }

        Mono<Void> deleteRequests = Mono.empty();
        if (StringUtils.hasText(responderInternalId)) {
            deleteRequests = deleteRequests.then(
                    requestRepository.delete(responderInternalId, sessionId)
                            .doOnSuccess(deleted -> {
                                if (Boolean.TRUE.equals(deleted)) {
                                    LOG.debug("Deleted pending request for responder {}",
                                            responderInternalId);
                                }
                            })
                            .then());
        }
        if (StringUtils.hasText(initiatorInternalId)) {
            deleteRequests = deleteRequests.then(
                    requestRepository.delete(initiatorInternalId, sessionId)
                            .doOnSuccess(deleted -> {
                                if (Boolean.TRUE.equals(deleted)) {
                                    LOG.debug("Deleted pending request for initiator {}",
                                            initiatorInternalId);
                                }
                            })
                            .then());
        }

        return Mono.when(
                messageRepository.deleteAllForSession(sessionId, participantInternalIds)
                        .doOnSuccess(count -> LOG.debug("Deleted {} messages for session {}",
                                count, sessionId)),
                deleteRequests
        );
    }

    private void sendBurnSignalToBothParticipants(String sessionId, String initiatorInternalId,
            String responderInternalId, Long burnedByTelegramId, Instant burnedAt) {
        BurnSignalEvent event = BurnSignalEvent.success(sessionId, burnedByTelegramId, burnedAt);
        sendBurnSignal(initiatorInternalId, event);
        sendBurnSignal(responderInternalId, event);
    }

    private void sendBurnSignal(String participantInternalId, BurnSignalEvent event) {
        if (!StringUtils.hasText(participantInternalId)) {
            LOG.warn("BURN_SIGNAL skip: participant internalId blank sessionId={}", event.getSessionId());
            return;
        }
        stompUserMessenger.convertAndSendToInternalId(
                participantInternalId, BURN_SIGNAL_DESTINATION, event);
        LOG.debug("Sent burn signal: participantInternalId={}, sessionId={}",
                participantInternalId, event.getSessionId());
    }

    private void sendBurnError(ParticipantContext participant, String sessionId, String errorCode) {
        BurnSignalEvent event = BurnSignalEvent.error(sessionId, errorCode);
        stompUserMessenger.convertAndSendToInternalId(
                participant.internalId(), BURN_SIGNAL_DESTINATION, event);
        LOG.trace("Sent burn error: internalId={}, code={}", participant.internalId(), errorCode);
    }
}

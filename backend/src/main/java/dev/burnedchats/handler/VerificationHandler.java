package dev.burnedchats.handler;

import dev.burnedchats.dto.event.VerificationEvent;
import dev.burnedchats.dto.request.VerificationRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.util.ParticipantContext;
import dev.burnedchats.security.AppPrincipal;
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

/**
 * STOMP handler for visual fingerprint verification.
 *
 * @see VerificationRequest
 * @see VerificationEvent
 * @see HandshakeHandler
 */
@Slf4j
@Controller
@RequiredArgsConstructor
@Validated
public class VerificationHandler {

    private static final String VERIFICATION_DESTINATION = "/queue/verification";

    private final SessionRepository sessionRepository;
    private final StompUserMessenger stompUserMessenger;

    @MessageMapping("/verification.confirm")
    public void confirmVerification(@Payload VerificationRequest request, Principal principal) {
        ParticipantContext participant = ParticipantContext.from(principal);
        if (participant == null) {
            LOG.warn("verification.confirm: unsupported principal type {}", principal.getClass().getName());
            return;
        }
        String sessionId = request.getSessionId();
        Boolean confirmed = request.getConfirmed();

        LOG.info("Verification confirmation received: sessionId={}, internalId={}, confirmed={}",
                sessionId, participant.internalId(), confirmed);

        if (!confirmed) {
            handleMismatch(sessionId, participant);
            return;
        }

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Session not found for verification: {}", sessionId);
                    sendError(participant, sessionId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> validateAndConfirm(session, participant))
                .subscribe(
                        result -> { },
                        error -> {
                            LOG.error("Error processing verification: sessionId={}, internalId={}, error={}",
                                    sessionId, participant.internalId(), error.getMessage());
                            sendError(participant, sessionId, "INTERNAL_ERROR");
                        }
            );
    }

    private Mono<Void> validateAndConfirm(Session session, ParticipantContext participant) {
        String userInternalId = participant.internalId();
        String sessionId = session.getId();

        if (!session.isParticipant(userInternalId)) {
            LOG.debug("User {} is not a participant in session {}", userInternalId, sessionId);
            sendError(participant, sessionId, "NOT_PARTICIPANT");
            return Mono.empty();
        }

        SessionStatus status = session.getStatus();
        if (status != SessionStatus.ACTIVE && status != SessionStatus.HANDSHAKE) {
            LOG.debug("Session {} is not active for verification: {}", sessionId, status);
            String errorCode = status == SessionStatus.BURNED ? "SESSION_BURNED"
                    : status == SessionStatus.PENDING ? "SESSION_NOT_READY"
                    : "SESSION_NOT_ACTIVE";
            sendError(participant, sessionId, errorCode);
            return Mono.empty();
        }

        boolean isInitiator = session.isInitiator(userInternalId);
        boolean wasInitiatorVerified = session.isInitiatorVerified();
        boolean wasResponderVerified = session.isResponderVerified();

        if (isInitiator) {
            session.setInitiatorVerified(true);
        } else {
            session.setResponderVerified(true);
        }

        boolean bothVerified = session.isInitiatorVerified() && session.isResponderVerified();
        session.touch();

        return sessionRepository.save(session)
                .doOnSuccess(savedSession -> {
                    Instant now = Instant.now();
                    String peerInternalId = session.getPeerInternalId(userInternalId);

                    sendVerificationStatus(participant, sessionId, true,
                            isInitiator ? wasResponderVerified : wasInitiatorVerified, now);

                    if (StringUtils.hasText(peerInternalId)) {
                        sendPeerVerified(peerInternalId, sessionId, bothVerified);
                    }

                    LOG.info("Verification confirmed: sessionId={}, internalId={}, bothVerified={}",
                            sessionId, userInternalId, bothVerified);
                })
                .then();
    }

    private void handleMismatch(String sessionId, ParticipantContext reporter) {
        LOG.warn("SECURITY: Fingerprint mismatch reported! sessionId={}, internalId={}",
                sessionId, reporter.internalId());

        sessionRepository.findById(sessionId)
                .subscribe(
                        session -> {
                            if (session != null && session.isParticipant(reporter.internalId())) {
                                String peerInternalId = session.getPeerInternalId(reporter.internalId());
                                sendMismatch(reporter, sessionId);
                                if (StringUtils.hasText(peerInternalId)) {
                                    sendMismatchToPeer(peerInternalId, sessionId);
                                }
                                LOG.warn("SECURITY: Mismatch notifications sent for session {}", sessionId);
                            }
                        },
                        error -> LOG.error("Error handling mismatch: {}", error.getMessage())
            );
    }

    private void sendVerificationStatus(ParticipantContext participant, String sessionId,
            boolean verified, boolean peerVerified, Instant timestamp) {
        VerificationEvent event = VerificationEvent.success(sessionId, verified, peerVerified, timestamp);
        stompUserMessenger.convertAndSendToInternalId(
                participant.internalId(), VERIFICATION_DESTINATION, event);
        LOG.debug(
                "Sent verification status: internalId={}, telegramId={}, sessionId={}, "
                        + "verified={}, peerVerified={}",
                participant.internalId(), participant.telegramId(), sessionId, verified, peerVerified);
    }

    private void sendPeerVerified(String peerInternalId, String sessionId, boolean bothVerified) {
        VerificationEvent event = VerificationEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .peerVerified(true)
                .bothVerified(bothVerified)
                .verifiedAt(Instant.now())
                .build();
        stompUserMessenger.convertAndSendToInternalId(peerInternalId, VERIFICATION_DESTINATION, event);
        LOG.debug("Sent peer verified notification: peerInternalId={}, sessionId={}, bothVerified={}",
                peerInternalId, sessionId, bothVerified);
    }

    private void sendMismatch(ParticipantContext reporter, String sessionId) {
        VerificationEvent event = VerificationEvent.mismatch(sessionId);
        stompUserMessenger.convertAndSendToInternalId(
                reporter.internalId(), VERIFICATION_DESTINATION, event);
        LOG.debug("Sent mismatch warning: internalId={}, sessionId={}",
                reporter.internalId(), sessionId);
    }

    private void sendMismatchToPeer(String peerInternalId, String sessionId) {
        stompUserMessenger.convertAndSendToInternalId(
                peerInternalId, VERIFICATION_DESTINATION, VerificationEvent.mismatch(sessionId));
        LOG.debug("Sent mismatch warning to peerInternalId={}: sessionId={}", peerInternalId, sessionId);
    }

    private void sendError(ParticipantContext participant, String sessionId, String errorCode) {
        VerificationEvent event = VerificationEvent.error(sessionId, errorCode);
        stompUserMessenger.convertAndSendToInternalId(
                participant.internalId(), VERIFICATION_DESTINATION, event);
        LOG.trace("Sent verification error: internalId={}, code={}",
                participant.internalId(), errorCode);
    }
}

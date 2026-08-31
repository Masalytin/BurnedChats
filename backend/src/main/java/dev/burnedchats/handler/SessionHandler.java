package dev.burnedchats.handler;

import dev.burnedchats.dto.event.ActiveSessionsListEvent;
import dev.burnedchats.dto.event.PeerDisconnectedEvent;
import dev.burnedchats.dto.event.RequestExpiredEvent;
import dev.burnedchats.dto.event.SessionAcceptedEvent;
import dev.burnedchats.dto.event.SessionCreatedEvent;
import dev.burnedchats.dto.event.SessionStatusEvent;
import dev.burnedchats.dto.request.AcceptSessionRequest;
import dev.burnedchats.dto.request.CreateSessionRequest;
import dev.burnedchats.dto.request.PeerDisconnectRequest;
import dev.burnedchats.dto.request.RejectSessionRequest;
import dev.burnedchats.dto.request.ResumeSessionRequest;
import dev.burnedchats.dto.request.SessionStatusRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.dto.event.SessionResumedEvent;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.security.AppPrincipal;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.exception.PowInvalidException;
import dev.burnedchats.exception.PowRequiredException;
import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.service.SessionLifecycleService;
import dev.burnedchats.service.SessionLifecycleService.AcceptSessionResult;
import dev.burnedchats.service.SessionLifecycleService.ActiveSessionsResult;
import dev.burnedchats.service.SessionLifecycleService.CreateSessionResult;
import dev.burnedchats.service.SessionLifecycleService.PendingTimeoutSignal;
import dev.burnedchats.telegram.BurnedChatsBot;
import dev.burnedchats.telegram.BotMessageService;
import dev.burnedchats.util.ParticipantContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Controller;
import org.springframework.util.StringUtils;
import org.springframework.validation.annotation.Validated;
import reactor.core.publisher.Mono;

import java.security.Principal;
import java.util.List;
import java.util.Map;

/**
 * Thin STOMP layer for chat session management.
 *
 * <p>Business logic lives in {@link SessionLifecycleService}; this handler maps
 * {@code @MessageMapping} endpoints to the service and delivers user-queued events.
 */
@Slf4j
@Controller
@RequiredArgsConstructor
@Validated
public class SessionHandler {

    private static final String ERRORS_DESTINATION = "/queue/errors";
    private static final String SESSION_CREATED_DESTINATION = "/queue/session-created";
    private static final String INCOMING_REQUEST_DESTINATION = "/queue/incoming-request";
    private static final String SESSION_ACCEPTED_DESTINATION = "/queue/session-accepted";
    private static final String SESSION_REJECTED_DESTINATION = "/queue/session-rejected";
    private static final String SESSION_STATUS_DESTINATION = "/queue/session-status";
    private static final String PEER_DISCONNECTED_DESTINATION = "/queue/peer-disconnected";
    private static final String ACTIVE_SESSIONS_DESTINATION = "/queue/active-sessions";
    private static final String SESSION_RESUMED_DESTINATION = "/queue/session-resumed";
    private static final String REQUEST_EXPIRED_DESTINATION = "/queue/request-expired";

    private final SessionRepository sessionRepository;
    private final OnlineStatusRepository onlineStatusRepository;
    private final StompUserMessenger stompUserMessenger;
    private final BurnedChatsBot telegramBot;
    private final BotMessageService botMessages;
    private final WebSocketExceptionHandler webSocketExceptionHandler;
    private final SessionLifecycleService sessionLifecycleService;

    private void sendStompToInternalId(String internalId, String destination, Object payload) {
        if (!StringUtils.hasText(internalId)) {
            LOG.warn("STOMP skip: internalId is blank destination={}", destination);
            return;
        }
        stompUserMessenger.convertAndSendToInternalId(internalId, destination, payload);
    }

    private void sendActiveSessionsSnapshot(
            AppPrincipal principal, ActiveSessionsListEvent event, String outcome) {
        stompUserMessenger.convertAndSendToUser(principal, ACTIVE_SESSIONS_DESTINATION, event);
        Long telegramId = principal instanceof TelegramPrincipal tp ? tp.getUserId() : null;
        LOG.info("Sent active sessions list: internalId={}, telegramId={}, {}",
                principal.getInternalId(), telegramId, outcome);
    }

    @MessageMapping("/session.create")
    public void createSession(@Payload CreateSessionRequest request, Principal principal) {
        ParticipantContext initiator = ParticipantContext.from(principal);
        if (initiator == null) {
            LOG.warn("Session create rejected: unsupported principal type {}",
                    principal == null ? "null" : principal.getClass().getName());
            return;
        }

        LOG.info("Session creation requested: initiatorInternalId={}, recipientInternalId={}, "
                        + "legacyRecipientId={}, hasQuestion={}",
                initiator.internalId(), request.getRecipientInternalId(), request.getRecipientId(),
                request.getSecretQuestion() != null);

        sessionLifecycleService.enforceSessionCreateGate(initiator, request)
                .then(sessionLifecycleService.createSession(initiator, request))
                .subscribe(
                        result -> dispatchCreateResult(initiator, result),
                        error -> handleSessionCreateFailure(initiator.internalId(), error));
    }

    private void dispatchCreateResult(ParticipantContext initiator, CreateSessionResult result) {
        switch (result) {
            case CreateSessionResult.Created created -> {
                sendStompToInternalId(created.recipientInternalId(), INCOMING_REQUEST_DESTINATION,
                        created.recipientEvent());
                LOG.debug("Sent incoming request event to recipient {}: sessionId={}",
                        created.recipientInternalId(), created.sessionId());

                if (!created.recipientOnline()) {
                    sendTelegramNotificationIfLinked(
                            created.recipientTelegramId(),
                            created.recipientUser(),
                            created.initiatorUser(),
                            created.sessionId());
                }

                sendToInitiator(initiator.internalId(), created.initiatorEvent());
            }
            case CreateSessionResult.Failed failed -> sendToInitiator(initiator.internalId(), failed.initiatorEvent());
        }
    }

    private void handleSessionCreateFailure(String initiatorInternalId, Throwable error) {
        Throwable root = error;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }

        if (root instanceof RateLimitException rateLimitException) {
            Map<String, Object> payload = webSocketExceptionHandler.handleRateLimitException(rateLimitException);
            sendStompToInternalId(initiatorInternalId, ERRORS_DESTINATION, payload);
            return;
        }
        if (root instanceof PowRequiredException powRequiredException) {
            Map<String, Object> payload = webSocketExceptionHandler.handlePowRequiredException(powRequiredException);
            sendStompToInternalId(initiatorInternalId, ERRORS_DESTINATION, payload);
            return;
        }
        if (root instanceof PowInvalidException powInvalidException) {
            Map<String, Object> payload = webSocketExceptionHandler.handlePowInvalidException(powInvalidException);
            sendStompToInternalId(initiatorInternalId, ERRORS_DESTINATION, payload);
            return;
        }

        LOG.error("Error creating session: initiator={}, error={}",
                initiatorInternalId, root.getMessage());
        sendToInitiator(initiatorInternalId, SessionCreatedEvent.error("INTERNAL_ERROR"));
    }

    private void sendTelegramNotificationIfLinked(Long recipientTelegramId, UnifiedUser recipient,
                                                    UnifiedUser sender, String sessionId) {
        if (recipientTelegramId == null) {
            LOG.debug("Telegram notification skip: recipient has no telegramId sessionId={}", sessionId);
            return;
        }
        botMessages.getForUser("bot.notify.chatRequest", recipientTelegramId)
                .subscribe(notificationText -> {
                    boolean sent = telegramBot.sendNotificationWithButton(
                            recipientTelegramId,
                            notificationText,
                            "dm_" + sessionId
                    );

                    if (sent) {
                        LOG.info("Telegram notification sent to recipient {}: sessionId={}",
                                recipientTelegramId, sessionId);
                    } else {
                        LOG.warn("Failed to send Telegram notification to recipient {}", recipientTelegramId);
                    }
                });
    }

    private void sendToInitiator(String initiatorInternalId, SessionCreatedEvent event) {
        sendStompToInternalId(initiatorInternalId, SESSION_CREATED_DESTINATION, event);
        LOG.trace("Sent session-created event to initiator {}: success={}, error={}",
                initiatorInternalId, event.isSuccess(), event.getError());
    }

    @MessageMapping("/session.pending")
    public void getPendingRequests(Principal principal) {
        ParticipantContext participant = ParticipantContext.from(principal);
        if (participant == null) {
            LOG.warn("Pending requests rejected: unsupported principal");
            return;
        }

        LOG.info("Pending requests requested: internalId={}, telegramId={}",
                participant.internalId(), participant.telegramId());

        sessionLifecycleService.pendingIncomingRequests(participant)
                .doOnNext(event -> {
                    stompUserMessenger.convertAndSendToInternalId(
                            participant.internalId(),
                            INCOMING_REQUEST_DESTINATION,
                            event
                    );
                    LOG.debug("Sent pending request to user {}: sessionId={}",
                            participant.internalId(), event.getSessionId());
                })
                .subscribe(
                        event -> {},
                        error -> LOG.error("Error sending pending requests to user {}: {}",
                                participant.internalId(), error.getMessage()),
                        () -> LOG.debug("Finished sending pending requests to user {}",
                                participant.internalId())
            );
    }

    @MessageMapping("/session.accept")
    public void acceptRequest(@Payload AcceptSessionRequest request, Principal principal) {
        ParticipantContext responder = ParticipantContext.from(principal);
        if (responder == null) {
            LOG.warn("Session accept rejected: unsupported principal");
            return;
        }
        String sessionId = request.getSessionId();

        LOG.info("Session accept requested: sessionId={}, responderInternalId={}",
                sessionId, responder.internalId());

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Session not found: {}", sessionId);
                    sendAcceptError(responder.internalId(), sessionId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> sessionLifecycleService.acceptSession(session, responder, request))
                .subscribe(
                        result -> dispatchAcceptResult(result),
                        error -> {
                            LOG.error("Error accepting session {}: {}", sessionId, error.getMessage());
                            sendAcceptError(responder.internalId(), sessionId, "INTERNAL_ERROR");
                        }
            );
    }

    private void dispatchAcceptResult(AcceptSessionResult result) {
        switch (result) {
            case AcceptSessionResult.Accepted accepted -> {
                sendStompToInternalId(accepted.initiatorInternalId(), SESSION_ACCEPTED_DESTINATION,
                        accepted.initiatorEvent());
                sendStompToInternalId(accepted.responderInternalId(), SESSION_ACCEPTED_DESTINATION,
                        accepted.responderEvent());
            }
            case AcceptSessionResult.Error error ->
                    sendAcceptError(error.responderInternalId(), error.sessionId(), error.errorCode());
        }
    }

    private void sendAcceptError(String responderInternalId, String sessionId, String errorCode) {
        SessionAcceptedEvent event = SessionAcceptedEvent.error(sessionId, errorCode);
        sendStompToInternalId(responderInternalId, SESSION_ACCEPTED_DESTINATION, event);
        LOG.trace("Sent accept error to responder {}: {}", responderInternalId, errorCode);
    }

    @MessageMapping("/session.status")
    public void checkSessionStatus(@Payload SessionStatusRequest request, Principal principal) {
        ParticipantContext participant = ParticipantContext.from(principal);
        if (participant == null) {
            return;
        }
        String sessionId = request.sessionId();

        LOG.debug("Session status check: sessionId={}, internalId={}", sessionId, participant.internalId());

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    sendSessionStatus(participant, SessionStatusEvent.expired(sessionId));
                    return Mono.empty();
                }))
                .subscribe(
                        session -> {
                            if (!session.isParticipant(participant.internalId())) {
                                sendSessionStatus(participant, SessionStatusEvent.error(sessionId, "NOT_PARTICIPANT"));
                                return;
                            }

                            if (session.getStatus() == SessionStatus.EXPIRED
                                    || session.getStatus() == SessionStatus.BURNED) {
                                sendSessionStatus(participant, SessionStatusEvent.expired(sessionId));
                                return;
                            }

                            if (session.isExpired(sessionLifecycleService.pendingTtl())) {
                                sendSessionStatus(participant, SessionStatusEvent.expired(sessionId));
                                return;
                            }

                            sendSessionStatus(participant, SessionStatusEvent.active(
                                    sessionId,
                                    session.getStatus(),
                                    session.getExpiresAt(sessionLifecycleService.pendingTtl()),
                                    session.getRemainingSeconds(sessionLifecycleService.pendingTtl())
                            ));
                        },
                        error -> {
                            LOG.error("Error checking session status: {}", error.getMessage());
                            sendSessionStatus(participant, SessionStatusEvent.error(sessionId, "INTERNAL_ERROR"));
                        }
            );
    }

    private void sendSessionStatus(ParticipantContext participant, SessionStatusEvent event) {
        sendStompToInternalId(participant.internalId(), SESSION_STATUS_DESTINATION, event);
    }

    @MessageMapping("/peer.disconnect")
    public void handlePeerDisconnect(@Payload PeerDisconnectRequest request, Principal principal) {
        ParticipantContext participant = ParticipantContext.from(principal);
        if (participant == null) {
            return;
        }
        String sessionId = request.sessionId();

        LOG.info("Peer disconnect notification: sessionId={}, internalId={}, reason={}",
                sessionId, participant.internalId(), request.reason());

        sessionRepository.findById(sessionId)
                .subscribe(
                        session -> {
                            if (!session.isParticipant(participant.internalId())) {
                                LOG.debug("User {} is not participant in session {}",
                                        participant.internalId(), sessionId);
                                return;
                            }

                            onlineStatusRepository.setOffline(participant.internalId())
                                    .subscribe(
                                            ignored -> LOG.debug(
                                                    "peer.disconnect marked sender offline: internalId={}",
                                                    participant.internalId()),
                                            error -> LOG.warn(
                                                    "peer.disconnect setOffline failed: internalId={}, error={}",
                                                    participant.internalId(), error.getMessage())
                                    );

                            String peerInternalId = session.getPeerInternalId(participant.internalId());
                            if (peerInternalId == null) {
                                return;
                            }

                            PeerDisconnectedEvent event = PeerDisconnectedEvent.appClosed(
                                    sessionId, participant.telegramId());
                            sendStompToInternalId(peerInternalId, PEER_DISCONNECTED_DESTINATION, event);

                            LOG.info(
                                    "Peer disconnect notify: peerInternalId={}, "
                                            + "disconnectedInternalId={}, sessionId={}",
                                    peerInternalId, participant.internalId(), sessionId);
                        },
                        error -> LOG.error("Error handling peer disconnect: {}", error.getMessage())
            );
    }

    @MessageMapping("/session.reject")
    public void rejectRequest(@Payload RejectSessionRequest request, Principal principal) {
        ParticipantContext responder = ParticipantContext.from(principal);
        if (responder == null) {
            return;
        }
        String sessionId = request.getSessionId();

        LOG.info("Session reject requested: sessionId={}, responderInternalId={}",
                sessionId, responder.internalId());

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Session not found for rejection: {}", sessionId);
                    return Mono.empty();
                }))
                .flatMap(session -> sessionLifecycleService.rejectSession(session, responder))
                .subscribe(
                        result -> sendStompToInternalId(
                                result.initiatorInternalId(), SESSION_REJECTED_DESTINATION, result.event()),
                        error -> LOG.error("Error rejecting session {}: {}", sessionId, error.getMessage())
            );
    }

    @MessageMapping("/session.active.list")
    public void getActiveSessions(Principal principal) {
        ParticipantContext participant = ParticipantContext.from(principal);
        if (participant == null) {
            return;
        }

        LOG.info("Getting active sessions: internalId={}, telegramId={}",
                participant.internalId(), participant.telegramId());

        sessionLifecycleService.listActiveSessions(participant)
                .flatMap(result -> cleanupExpiredAndNotify(result).thenReturn(result))
                .subscribe(
                        result -> {
                            if (principal instanceof AppPrincipal appPrincipal) {
                                sendActiveSessionsSnapshot(
                                        appPrincipal, result.event(), "count=" + result.event().getCount());
                            }
                        },
                        error -> {
                            LOG.error("Error getting active sessions for user {}: {}",
                                    participant.internalId(), error.getMessage());
                            if (principal instanceof AppPrincipal appPrincipal) {
                                sendActiveSessionsSnapshot(
                                        appPrincipal,
                                        ActiveSessionsListEvent.error("INTERNAL_ERROR"),
                                        "error=INTERNAL_ERROR");
                            }
                        }
            );
    }

    @MessageMapping("/session.resume")
    public void resumeSession(@Payload ResumeSessionRequest request, Principal principal) {
        ParticipantContext participant = ParticipantContext.from(principal);
        if (participant == null) {
            return;
        }
        String sessionId = request.sessionId();

        LOG.info("Session resume requested: sessionId={}, internalId={}, telegramId={}",
                sessionId, participant.internalId(), participant.telegramId());

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Session not found for resume: {}", sessionId);
                    sendResumeEvent(participant, SessionResumedEvent.error(sessionId, "SESSION_NOT_FOUND"));
                    return Mono.empty();
                }))
                .flatMap(session -> sessionLifecycleService.resumeSession(session, participant))
                .subscribe(
                        result -> {
                            publishPendingTimeouts(result.pendingTimeouts());
                            sendResumeEvent(participant, result.event());
                        },
                        error -> {
                            LOG.error("Error resuming session {}: {}", sessionId, error.getMessage());
                            sendResumeEvent(participant, SessionResumedEvent.error(sessionId, "INTERNAL_ERROR"));
                        }
            );
    }

    private void sendResumeEvent(ParticipantContext participant, SessionResumedEvent event) {
        sendStompToInternalId(participant.internalId(), SESSION_RESUMED_DESTINATION, event);
    }

    private Mono<Void> cleanupExpiredAndNotify(ActiveSessionsResult result) {
        Mono<Void> cleanup = result.expiredSessionIds().isEmpty()
                ? Mono.empty()
                : sessionLifecycleService.cleanupExpiredSessions(result.expiredSessionIds());
        return cleanup.doOnSuccess(ignored -> publishPendingTimeouts(result.pendingTimeouts()));
    }

    private void publishPendingTimeouts(List<PendingTimeoutSignal> signals) {
        if (signals == null || signals.isEmpty()) {
            return;
        }
        for (PendingTimeoutSignal signal : signals) {
            publishPendingTimeoutIfOnline(signal);
        }
    }

    private void publishPendingTimeoutIfOnline(PendingTimeoutSignal signal) {
        if (signal == null) {
            return;
        }
        String initiatorId = signal.initiatorInternalId();
        RequestExpiredEvent event = RequestExpiredEvent.timeout(signal.sessionId());
        onlineStatusRepository.isOnline(initiatorId)
                .filter(Boolean::booleanValue)
                .subscribe(
                        ignored -> sendStompToInternalId(
                                initiatorId, REQUEST_EXPIRED_DESTINATION, event),
                        error -> LOG.warn(
                                "request-expired online check failed: initiator={}, error={}",
                                initiatorId, error.getMessage()));
    }

}

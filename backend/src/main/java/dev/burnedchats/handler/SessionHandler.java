package dev.burnedchats.handler;

import dev.burnedchats.dto.event.ActiveSessionsListEvent;
import dev.burnedchats.dto.event.IncomingRequestEvent;
import dev.burnedchats.dto.event.SessionAcceptedEvent;
import dev.burnedchats.dto.event.SessionCreatedEvent;
import dev.burnedchats.dto.event.SessionRejectedEvent;
import dev.burnedchats.dto.event.SessionResumedEvent;
import dev.burnedchats.dto.event.PeerDisconnectedEvent;
import dev.burnedchats.dto.event.SessionStatusEvent;
import dev.burnedchats.dto.mapper.UserMapper;
import dev.burnedchats.dto.mapper.SessionMapper;
import dev.burnedchats.dto.request.AcceptSessionRequest;
import dev.burnedchats.dto.request.CreateSessionRequest;
import dev.burnedchats.dto.request.RejectSessionRequest;
import dev.burnedchats.dto.request.ResumeSessionRequest;
import dev.burnedchats.dto.request.PeerDisconnectRequest;
import dev.burnedchats.dto.request.SessionStatusRequest;
import dev.burnedchats.dto.response.SessionResponse;
import dev.burnedchats.dto.response.UserResponse;
import dev.burnedchats.model.ChatRequest;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.RequestRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.security.AppPrincipal;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.telegram.BurnedChatsBot;
import dev.burnedchats.telegram.BotMessageService;
import dev.burnedchats.util.InternalIds;
import dev.burnedchats.util.SecretAnswerHasher;
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
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * STOMP handler for chat session management.
 *
 * <p>Handles session lifecycle operations:
 * <ul>
 *   <li>Creating new chat session requests</li>
 *   <li>Accepting incoming requests</li>
 *   <li>Rejecting incoming requests</li>
 *   <li>Sending notifications to participants</li>
 * </ul>
 *
 * <p>Destinations:
 * <ul>
 *   <li>{@code /app/session.create} - create new session request</li>
 *   <li>{@code /app/session.accept} - accept incoming request</li>
 *   <li>{@code /app/session.reject} - reject incoming request</li>
 * </ul>
 *
 * <p>Events sent:
 * <ul>
 *   <li>{@code /user/queue/session-created} - sent to initiator after creation</li>
 *   <li>{@code /user/queue/incoming-request} - sent to recipient</li>
 *   <li>{@code /user/queue/session-accepted} - sent to both after acceptance</li>
 *   <li>{@code /user/queue/session-rejected} - sent to initiator after rejection</li>
 * </ul>
 *
 * <p>Additionally, if the recipient is offline, a Telegram notification
 * is sent via the bot with a button to open the Mini App.
 *
 * @see CreateSessionRequest
 * @see AcceptSessionRequest
 * @see RejectSessionRequest
 * @see SessionCreatedEvent
 * @see SessionAcceptedEvent
 * @see SessionRejectedEvent
 * @see IncomingRequestEvent
 */
@Slf4j
@Controller
@RequiredArgsConstructor
@Validated
public class SessionHandler {

    /**
     * STOMP destination for session created event (sent to initiator).
     */
    private static final String SESSION_CREATED_DESTINATION = "/queue/session-created";

    /**
     * STOMP destination for incoming request event (sent to recipient).
     */
    private static final String INCOMING_REQUEST_DESTINATION = "/queue/incoming-request";

    /**
     * STOMP destination for session accepted event (sent to both participants).
     */
    private static final String SESSION_ACCEPTED_DESTINATION = "/queue/session-accepted";

    /**
     * STOMP destination for session rejected event (sent to initiator).
     */
    private static final String SESSION_REJECTED_DESTINATION = "/queue/session-rejected";

    /**
     * STOMP destination for session status event (5.1.4).
     */
    private static final String SESSION_STATUS_DESTINATION = "/queue/session-status";

    /**
     * STOMP destination for peer disconnected event (5.1.5).
     */
    private static final String PEER_DISCONNECTED_DESTINATION = "/queue/peer-disconnected";

    /**
     * STOMP destination for active sessions list event (4.6.1).
     */
    private static final String ACTIVE_SESSIONS_DESTINATION = "/queue/active-sessions";

    /**
     * STOMP destination for session resumed event (4.6.3).
     */
    private static final String SESSION_RESUMED_DESTINATION = "/queue/session-resumed";

    private static final Pattern UUID_PATTERN = Pattern.compile(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    private record ParticipantContext(String internalId, Long telegramId) {
    }

    private final SessionRepository sessionRepository;
    private final RequestRepository requestRepository;
    private final OnlineStatusRepository onlineStatusRepository;
    private final UserMapper userMapper;
    private final SessionMapper sessionMapper;
    private final StompUserMessenger stompUserMessenger;
    private final UserIdentityRepository userIdentityRepository;
    private final BurnedChatsBot telegramBot;
    private final BotMessageService botMessages;

    /**
     * Resolves authenticated participant context from any {@link AppPrincipal}.
     */
    private ParticipantContext participantContext(Principal principal) {
        if (!(principal instanceof AppPrincipal appPrincipal)) {
            return null;
        }
        Long telegramId = principal instanceof TelegramPrincipal telegramPrincipal
                ? telegramPrincipal.getUserId()
                : null;
        return new ParticipantContext(appPrincipal.getInternalId(), telegramId);
    }

    private void sendStompToInternalId(String internalId, String destination, Object payload) {
        if (!StringUtils.hasText(internalId)) {
            LOG.warn("STOMP skip: internalId is blank destination={}", destination);
            return;
        }
        stompUserMessenger.convertAndSendToInternalId(internalId, destination, payload);
    }

    /**
     * Best-effort Telegram bot notification when recipient has a linked telegram id.
     */
    private void sendTelegramNotificationIfLinked(Long recipientTelegramId, UnifiedUser recipient,
                                                   UnifiedUser sender, String sessionId) {
        if (recipientTelegramId == null) {
            LOG.debug("Telegram notification skip: recipient has no telegramId sessionId={}", sessionId);
            return;
        }
        sendTelegramNotification(recipientTelegramId, recipient, sender, sessionId);
    }

    /**
     * Resolves {@link dev.burnedchats.model.UnifiedUser#internalId()} for STOMP user delivery by Telegram id.
     * Skips delivery with a warning when the mapping is missing.
     *
     * @deprecated Prefer {@link #sendStompToInternalId}
     */
    @Deprecated
    private void sendStompToTelegramUser(Long telegramId, String destination, Object payload) {
        if (telegramId == null) {
            LOG.warn("STOMP skip: telegramId is null destination={}", destination);
            return;
        }
        userIdentityRepository.findByTelegramId(telegramId)
                .filter(StringUtils::hasText)
                .doOnNext(internalId -> stompUserMessenger.convertAndSendToInternalId(
                        internalId, destination, payload))
                .switchIfEmpty(Mono.fromRunnable(() -> LOG.warn(
                        "STOMP skip: no internalId for telegramId={} destination={}", telegramId, destination)))
                .subscribe();
    }

    /**
     * Single entry point for {@link ActiveSessionsListEvent} to the requesting user
     * (avoids duplicated resolve/send logic).
     */
    private void sendActiveSessionsSnapshot(
            AppPrincipal principal, ActiveSessionsListEvent event, String outcome) {
        stompUserMessenger.convertAndSendToUser(principal, ACTIVE_SESSIONS_DESTINATION, event);
        Long telegramId = principal instanceof TelegramPrincipal tp ? tp.getUserId() : null;
        LOG.info("Sent active sessions list: internalId={}, telegramId={}, {}",
                principal.getInternalId(), telegramId, outcome);
    }

    /**
     * Create a new chat session request.
     *
     * <p>Flow:
     * <ol>
     *   <li>Validate request (not self, no existing session, etc.)</li>
     *   <li>Create Session with PENDING status</li>
     *   <li>Create ChatRequest for recipient's queue</li>
     *   <li>Send SessionCreatedEvent to initiator</li>
     *   <li>Send IncomingRequestEvent to recipient via WebSocket</li>
     *   <li>Send Telegram notification if recipient is offline</li>
     * </ol>
     *
     * @param request   the create session request payload
     * @param principal authenticated user principal
     */
    @MessageMapping("/session.create")
    public void createSession(@Payload CreateSessionRequest request, Principal principal) {
        ParticipantContext initiator = participantContext(principal);
        if (initiator == null) {
            LOG.warn("Session create rejected: unsupported principal type {}",
                    principal == null ? "null" : principal.getClass().getName());
            return;
        }

        String secretQuestion = normalizeOptionalText(request.getSecretQuestion());
        String secretExpectedAnswer = normalizeOptionalText(request.getSecretExpectedAnswer());

        LOG.info("Session creation requested: initiatorInternalId={}, recipientInternalId={}, "
                        + "legacyRecipientId={}, hasQuestion={}",
                initiator.internalId(), request.getRecipientInternalId(), request.getRecipientId(),
                secretQuestion != null);

        resolveRecipientInternalId(request)
                .flatMap(recipientInternalId -> {
                    if (initiator.internalId().equals(recipientInternalId)) {
                        LOG.debug("Self-request rejected for user {}", initiator.internalId());
                        return Mono.just(SessionCreatedEvent.error("SELF_REQUEST"));
                    }

                    if (secretQuestion != null) {
                        if (secretExpectedAnswer == null) {
                            LOG.debug("Secret question present without expected answer: initiator={}",
                                    initiator.internalId());
                            return Mono.just(SessionCreatedEvent.error("EXPECTED_ANSWER_REQUIRED"));
                        }
                        if (secretExpectedAnswer.length() > 256) {
                            return Mono.just(SessionCreatedEvent.error("EXPECTED_ANSWER_TOO_LONG"));
                        }
                    }

                    return validateAndCreateSession(initiator, recipientInternalId, secretQuestion,
                            secretExpectedAnswer);
                })
                .switchIfEmpty(Mono.fromSupplier(() -> SessionCreatedEvent.error("INVALID_RECIPIENT")))
                .subscribe(
                        event -> sendToInitiator(initiator.internalId(), event),
                        error -> {
                            LOG.error("Error creating session: initiator={}, error={}",
                                    initiator.internalId(), error.getMessage());
                            sendToInitiator(initiator.internalId(), SessionCreatedEvent.error("INTERNAL_ERROR"));
                        }
                );
    }

    private Mono<String> resolveRecipientInternalId(CreateSessionRequest request) {
        if (StringUtils.hasText(request.getRecipientInternalId())) {
            String trimmed = request.getRecipientInternalId().trim();
            if (UUID_PATTERN.matcher(trimmed).matches()) {
                return Mono.just(trimmed);
            }
            return Mono.empty();
        }
        if (request.getRecipientId() != null) {
            return userIdentityRepository.findByTelegramId(request.getRecipientId())
                    .switchIfEmpty(Mono.just(InternalIds.forTelegramId(request.getRecipientId())));
        }
        return Mono.empty();
    }

    /**
     * Trim and treat empty string as absent.
     */
    private static String normalizeOptionalText(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private Mono<SessionCreatedEvent> validateAndCreateSession(ParticipantContext initiator,
                                                               String recipientInternalId,
                                                               String secretQuestion,
                                                               String secretExpectedAnswer) {
        return sessionRepository.findActiveByParticipant(initiator.internalId())
                .flatMap(existingSession -> {
                    LOG.debug("Initiator {} already has active session: {}",
                            initiator.internalId(), existingSession.getId());
                    return Mono.just(SessionCreatedEvent.error("ALREADY_HAS_SESSION"));
                })
                .switchIfEmpty(
                        sessionRepository.findActiveByParticipant(recipientInternalId)
                                .flatMap(existingSession -> {
                                    LOG.debug("Recipient {} already has active session: {}",
                                            recipientInternalId, existingSession.getId());
                                    return Mono.just(SessionCreatedEvent.error("RECIPIENT_HAS_SESSION"));
                                })
                                .switchIfEmpty(
                                        requestRepository.existsBetween(initiator.internalId(), recipientInternalId)
                                                .flatMap(exists -> {
                                                    if (exists) {
                                                        LOG.debug("Pending request already exists: {} -> {}",
                                                                initiator.internalId(), recipientInternalId);
                                                        return Mono.just(SessionCreatedEvent.error(
                                                                "PENDING_REQUEST_EXISTS"));
                                                    }
                                                    return doCreateSession(initiator, recipientInternalId,
                                                            secretQuestion, secretExpectedAnswer);
                                                })
                                )
                );
    }

    private Mono<SessionCreatedEvent> doCreateSession(ParticipantContext initiator,
                                                      String recipientInternalId,
                                                      String secretQuestion,
                                                      String secretExpectedAnswer) {
        return Mono.zip(
                loadParticipant(initiator.internalId()),
                loadParticipant(recipientInternalId)
        ).flatMap(users -> {
            UnifiedUser initiatorUser = users.getT1();
            UnifiedUser recipientUser = users.getT2();
            String sessionId = UUID.randomUUID().toString();
            Instant now = Instant.now();
            Session session = newPendingSession(
                    sessionId,
                    initiator.internalId(),
                    initiator.telegramId(),
                    recipientInternalId,
                    recipientUser.telegramId(),
                    now,
                    secretQuestion,
                    secretExpectedAnswer);
            ChatRequest chatRequest = ChatRequest.fromParticipants(
                    sessionId,
                    initiatorUser,
                    recipientInternalId,
                    recipientUser.telegramId(),
                    secretQuestion);

            return sessionRepository.save(session)
                    .then(requestRepository.save(chatRequest))
                    .then(onlineStatusRepository.isOnline(recipientInternalId))
                    .flatMap(isRecipientOnline -> {
                        sendIncomingRequestToRecipient(recipientInternalId, sessionId, initiatorUser,
                                secretQuestion, now, chatRequest.getExpiresAt());

                        if (!isRecipientOnline) {
                            sendTelegramNotificationIfLinked(
                                    recipientUser.telegramId(), recipientUser, initiatorUser, sessionId);
                        }

                        UserResponse recipientResponse = userMapper.toResponse(recipientUser, isRecipientOnline);

                        LOG.info("Session created successfully: sessionId={}, initiator={}, recipient={}, online={}",
                                sessionId, initiator.internalId(), recipientInternalId, isRecipientOnline);

                        return Mono.just(SessionCreatedEvent.success(
                                sessionId,
                                recipientResponse,
                                secretQuestion != null && !secretQuestion.isBlank(),
                                now,
                                chatRequest.getExpiresAt()
                        ));
                    });
        });
    }

    private Mono<UnifiedUser> loadParticipant(String internalId) {
        return userIdentityRepository.findById(internalId)
                .switchIfEmpty(Mono.just(placeholderUnifiedUser(internalId)));
    }

    private static UnifiedUser placeholderUnifiedUser(String internalId) {
        return new UnifiedUser(
                internalId,
                dev.burnedchats.model.enums.AuthType.WALLET,
                "User",
                null,
                null,
                null);
    }

    private static Session newPendingSession(String sessionId,
                                             String initiatorInternalId,
                                             Long initiatorTelegramId,
                                             String recipientInternalId,
                                             Long recipientTelegramId,
                                             Instant now,
                                             String secretQuestion,
                                             String secretExpectedAnswer) {
        return Session.builder()
                .id(sessionId)
                .initiatorInternalId(initiatorInternalId)
                .initiatorTelegramId(initiatorTelegramId)
                .responderInternalId(recipientInternalId)
                .responderTelegramId(recipientTelegramId)
                .status(SessionStatus.PENDING)
                .createdAt(now)
                .lastActivityAt(now)
                .secretQuestion(secretQuestion)
                .secretAnswerHash(secretQuestion != null
                        ? SecretAnswerHasher.hash(secretExpectedAnswer)
                        : null)
                .build();
    }

    private void sendIncomingRequestToRecipient(String recipientInternalId, String sessionId,
                                                 UnifiedUser sender, String secretQuestion,
                                                 Instant createdAt, Instant expiresAt) {
        UserResponse senderResponse = userMapper.toResponse(sender, true);
        IncomingRequestEvent event = IncomingRequestEvent.create(
                sessionId, senderResponse, secretQuestion, createdAt, expiresAt
        );

        sendStompToInternalId(recipientInternalId, INCOMING_REQUEST_DESTINATION, event);

        LOG.debug("Sent incoming request event to recipient {}: sessionId={}", recipientInternalId, sessionId);
    }

    /**
     * Send Telegram notification to offline recipient with a linked Telegram account.
     */
    private void sendTelegramNotification(Long recipientTelegramId, UnifiedUser recipient,
                                           UnifiedUser sender, String sessionId) {
        botMessages.getForUser("bot.notify.chatRequest", recipientTelegramId)
                .subscribe(notificationText -> {
                    boolean sent = telegramBot.sendNotificationWithButton(
                            recipientTelegramId,
                            notificationText,
                            sessionId
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

    // ==================== Pending Requests (Fix: race condition on connect) ====================

    /**
     * Get pending incoming requests for the authenticated user.
     *
     * <p>This endpoint allows the client to explicitly fetch pending requests
     * after establishing WebSocket subscriptions. This fixes a race condition
     * where the server sends pending requests on SessionConnectedEvent before
     * the client's SUBSCRIBE frames arrive.
     *
     * @param principal authenticated user principal
     */
    @MessageMapping("/session.pending")
    public void getPendingRequests(Principal principal) {
        ParticipantContext participant = participantContext(principal);
        if (participant == null) {
            LOG.warn("Pending requests rejected: unsupported principal");
            return;
        }

        LOG.info("Pending requests requested: internalId={}, telegramId={}",
                participant.internalId(), participant.telegramId());

        requestRepository.findByRecipient(participant.internalId())
                .flatMap(request -> buildIncomingRequestEvent(request)
                        .doOnNext(event -> {
                            stompUserMessenger.convertAndSendToInternalId(
                                    participant.internalId(),
                                    INCOMING_REQUEST_DESTINATION,
                                    event
                            );
                            LOG.debug("Sent pending request to user {}: sessionId={}",
                                    participant.internalId(), event.getSessionId());
                        }))
                .subscribe(
                        event -> {},
                        error -> LOG.error("Error sending pending requests to user {}: {}",
                                participant.internalId(), error.getMessage()),
                        () -> LOG.debug("Finished sending pending requests to user {}",
                                participant.internalId())
            );
    }

    private reactor.core.publisher.Mono<IncomingRequestEvent> buildIncomingRequestEvent(
            ChatRequest request) {
        String senderInternalId = request.getSenderKey();
        if (!StringUtils.hasText(senderInternalId)) {
            return Mono.just(IncomingRequestEvent.create(
                    request.getSessionId(),
                    buildPlaceholderSender(request),
                    request.getQuestion(),
                    request.getCreatedAt(),
                    request.getExpiresAt()
            ));
        }
        return loadParticipant(senderInternalId)
                .flatMap(sender -> onlineStatusRepository.isOnline(senderInternalId)
                        .map(online -> userMapper.toResponse(sender, online)))
                .defaultIfEmpty(buildPlaceholderSender(request))
                .map(senderResponse -> IncomingRequestEvent.create(
                        request.getSessionId(),
                        senderResponse,
                        request.getQuestion(),
                        request.getCreatedAt(),
                        request.getExpiresAt()
                ));
    }

    private UserResponse buildPlaceholderSender(ChatRequest request) {
        String displayName = request.getSenderFirstName();
        if (request.getSenderLastName() != null) {
            displayName += " " + request.getSenderLastName();
        }

        return UserResponse.builder()
                .internalId(request.getSenderInternalId())
                .id(request.getSenderTgId())
                .username(request.getSenderUsername())
                .displayName(displayName)
                .photoUrl(request.getSenderPhotoUrl())
                .online(true)
                .premium(false)
                .build();
    }

    // ==================== Accept Request (Task 3.4.2) ====================

    /**
     * Accept an incoming chat request.
     *
     * <p>Flow:
     * <ol>
     *   <li>Validate session exists and is PENDING</li>
     *   <li>Validate user is the responder</li>
     *   <li>Validate secret answer if required</li>
     *   <li>Update session status to HANDSHAKE</li>
     *   <li>Remove request from queue</li>
     *   <li>Send SessionAcceptedEvent to both participants</li>
     * </ol>
     *
     * @param request   the accept session request payload
     * @param principal authenticated user principal
     */
    @MessageMapping("/session.accept")
    public void acceptRequest(@Payload AcceptSessionRequest request, Principal principal) {
        ParticipantContext responder = participantContext(principal);
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
                .flatMap(session -> validateAndAcceptSession(session, responder, request))
                .subscribe(
                        result -> {},
                        error -> {
                            LOG.error("Error accepting session {}: {}", sessionId, error.getMessage());
                            sendAcceptError(responder.internalId(), sessionId, "INTERNAL_ERROR");
                        }
            );
    }

    private Mono<Void> validateAndAcceptSession(Session session, ParticipantContext responder,
                                                 AcceptSessionRequest request) {
        String sessionId = session.getId();

        if (!session.isResponder(responder.internalId())) {
            LOG.debug("User {} is not responder for session {}", responder.internalId(), sessionId);
            sendAcceptError(responder.internalId(), sessionId, "NOT_RESPONDER");
            return Mono.empty();
        }

        if (session.getStatus() != SessionStatus.PENDING) {
            LOG.debug("Session {} is not pending, status: {}", sessionId, session.getStatus());
            String errorCode = session.getStatus() == SessionStatus.HANDSHAKE
                    || session.getStatus() == SessionStatus.ACTIVE
                    ? "ALREADY_ACCEPTED" : "SESSION_EXPIRED";
            sendAcceptError(responder.internalId(), sessionId, errorCode);
            return Mono.empty();
        }

        return requestRepository.findBySessionId(responder.internalId(), sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Request not found for session: {}", sessionId);
                    sendAcceptError(responder.internalId(), sessionId, "REQUEST_EXPIRED");
                    return Mono.empty();
                }))
                .flatMap(chatRequest -> {
                    if (chatRequest.isHasQuestion()) {
                        String providedAnswer = request.getSecretAnswer();
                        if (providedAnswer == null || providedAnswer.isBlank()) {
                            LOG.debug("Secret answer required but not provided for session {}", sessionId);
                            sendAcceptError(responder.internalId(), sessionId, "ANSWER_REQUIRED");
                            return Mono.empty();
                        }
                        String expectedHash = session.getSecretAnswerHash();
                        if (expectedHash == null || expectedHash.isBlank()) {
                            LOG.warn("Session {} has secret question but missing expected answer hash", sessionId);
                            sendAcceptError(responder.internalId(), sessionId, "INTERNAL_ERROR");
                            return Mono.empty();
                        }
                        String providedHash = SecretAnswerHasher.hash(providedAnswer);
                        if (!SecretAnswerHasher.constantTimeEquals(providedHash, expectedHash)) {
                            LOG.debug("Wrong secret answer for session {}", sessionId);
                            sendAcceptError(responder.internalId(), sessionId, "WRONG_ANSWER");
                            return Mono.empty();
                        }
                        return doAcceptSession(session, responder);
                    }
                    return doAcceptSession(session, responder);
                });
    }

    private Mono<Void> doAcceptSession(Session session, ParticipantContext responder) {
        String sessionId = session.getId();
        String initiatorInternalId = session.getInitiatorInternalId();
        Instant acceptedAt = Instant.now();

        session.setStatus(SessionStatus.HANDSHAKE);
        session.setLastActivityAt(acceptedAt);

        return sessionRepository.save(session)
                .then(requestRepository.delete(responder.internalId(), sessionId))
                .then(Mono.zip(
                        getUserResponseByInternalId(initiatorInternalId),
                        getUserResponseByInternalId(responder.internalId())
                ))
                .doOnSuccess(users -> {
                    UserResponse initiatorInfo = users.getT1();
                    UserResponse responderInfo = users.getT2();
                    Instant expiresAt = session.getExpiresAt();

                    SessionAcceptedEvent initiatorEvent = SessionAcceptedEvent.success(
                            sessionId, responderInfo, acceptedAt, expiresAt);
                    sendStompToInternalId(initiatorInternalId, SESSION_ACCEPTED_DESTINATION, initiatorEvent);

                    SessionAcceptedEvent responderEvent = SessionAcceptedEvent.success(
                            sessionId, initiatorInfo, acceptedAt, expiresAt);
                    sendStompToInternalId(responder.internalId(), SESSION_ACCEPTED_DESTINATION, responderEvent);

                    LOG.info(
                            "Session accepted: sessionId={}, initiatorInternalId={}, responderInternalId={}, "
                                    + "expiresAt={}",
                            sessionId, initiatorInternalId, responder.internalId(), expiresAt);
                })
                .then();
    }

    private Mono<UserResponse> getUserResponseByInternalId(String internalId) {
        return Mono.zip(
                loadParticipant(internalId),
                onlineStatusRepository.isOnline(internalId)
        ).map(tuple -> userMapper.toResponse(tuple.getT1(), tuple.getT2()));
    }

    private void sendAcceptError(String responderInternalId, String sessionId, String errorCode) {
        SessionAcceptedEvent event = SessionAcceptedEvent.error(sessionId, errorCode);
        sendStompToInternalId(responderInternalId, SESSION_ACCEPTED_DESTINATION, event);
        LOG.trace("Sent accept error to responder {}: {}", responderInternalId, errorCode);
    }

    // ==================== Session Status (5.1.4) ====================

    /**
     * Check session status and remaining time (5.1.4).
     *
     * <p>Used by clients to verify if a session is still active
     * and to get the remaining time until expiration.
     *
     * @param request   the session status request
     * @param principal authenticated user principal
     */
    @MessageMapping("/session.status")
    public void checkSessionStatus(@Payload SessionStatusRequest request, Principal principal) {
        ParticipantContext participant = participantContext(principal);
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

                            if (session.isExpired()) {
                                sendSessionStatus(participant, SessionStatusEvent.expired(sessionId));
                                return;
                            }

                            sendSessionStatus(participant, SessionStatusEvent.active(
                                    sessionId,
                                    session.getStatus(),
                                    session.getExpiresAt(),
                                    session.getRemainingSeconds()
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

    // ==================== Peer Disconnect (5.1.5) ====================

    /**
     * Handle peer disconnect notification (5.1.5).
     *
     * <p>Called when a user is about to close the Mini App.
     * Notifies the peer that the other participant has disconnected.
     *
     * @param request   the disconnect request
     * @param principal authenticated user principal
     */
    @MessageMapping("/peer.disconnect")
    public void handlePeerDisconnect(@Payload PeerDisconnectRequest request, Principal principal) {
        ParticipantContext participant = participantContext(principal);
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

                            String peerInternalId = session.getPeerInternalId(participant.internalId());
                            if (peerInternalId == null) {
                                return;
                            }

                            PeerDisconnectedEvent event = PeerDisconnectedEvent.appClosed(
                                    sessionId, participant.telegramId());
                            sendStompToInternalId(peerInternalId, PEER_DISCONNECTED_DESTINATION, event);

                            LOG.info(
                                    "Peer disconnect notify: peerInternalId={}, disconnectedInternalId={}, sessionId={}",
                                    peerInternalId, participant.internalId(), sessionId);
                        },
                        error -> LOG.error("Error handling peer disconnect: {}", error.getMessage())
            );
    }

    // ==================== Reject Request (Task 3.4.3) ====================

    /**
     * Reject an incoming chat request.
     *
     * <p>Flow:
     * <ol>
     *   <li>Validate session exists and is PENDING</li>
     *   <li>Validate user is the responder</li>
     *   <li>Update session status to EXPIRED</li>
     *   <li>Remove request from queue</li>
     *   <li>Send SessionRejectedEvent to initiator</li>
     * </ol>
     *
     * @param request   the reject session request payload
     * @param principal authenticated user principal
     */
    @MessageMapping("/session.reject")
    public void rejectRequest(@Payload RejectSessionRequest request, Principal principal) {
        ParticipantContext responder = participantContext(principal);
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
                .flatMap(session -> validateAndRejectSession(session, responder))
                .subscribe(
                        result -> {},
                        error -> LOG.error("Error rejecting session {}: {}", sessionId, error.getMessage())
            );
    }

    private Mono<Void> validateAndRejectSession(Session session, ParticipantContext responder) {
        String sessionId = session.getId();

        if (!session.isResponder(responder.internalId())) {
            LOG.debug("User {} is not responder for session {}, cannot reject",
                    responder.internalId(), sessionId);
            return Mono.empty();
        }

        if (session.getStatus() != SessionStatus.PENDING) {
            LOG.debug("Session {} is not pending, cannot reject. Status: {}", sessionId, session.getStatus());
            return Mono.empty();
        }

        return doRejectSession(session, responder);
    }

    private Mono<Void> doRejectSession(Session session, ParticipantContext responder) {
        String sessionId = session.getId();
        String initiatorInternalId = session.getInitiatorInternalId();
        Instant rejectedAt = Instant.now();

        return sessionRepository.updateStatus(sessionId, SessionStatus.EXPIRED)
                .then(requestRepository.delete(responder.internalId(), sessionId))
                .doOnSuccess(v -> {
                    SessionRejectedEvent event = SessionRejectedEvent.create(sessionId, rejectedAt);
                    sendStompToInternalId(initiatorInternalId, SESSION_REJECTED_DESTINATION, event);

                    LOG.info("Session rejected: sessionId={}, initiatorInternalId={}, responderInternalId={}",
                            sessionId, initiatorInternalId, responder.internalId());
                })
                .then();
    }

    // ==================== Active Sessions (4.6.1, 4.6.2, 4.6.4) ====================

    private Mono<SessionResponse> mapSessionToListResponse(Session session, String userInternalId,
            List<String> expiredSessionIds) {
        if (session.isExpired()) {
            synchronized (expiredSessionIds) {
                expiredSessionIds.add(session.getId());
            }
            LOG.debug("Session {} is expired, marking for cleanup", session.getId());
            return Mono.<SessionResponse>empty();
        }

        String peerInternalId = session.getPeerInternalId(userInternalId);
        boolean isInitiator = session.isInitiator(userInternalId);

        return getUserResponseByInternalId(peerInternalId)
                .map(peerResponse -> sessionMapper.toResponse(session, peerResponse, isInitiator));
    }

    @MessageMapping("/session.active.list")
    public void getActiveSessions(Principal principal) {
        ParticipantContext participant = participantContext(principal);
        if (participant == null) {
            return;
        }

        LOG.info("Getting active sessions: internalId={}, telegramId={}",
                participant.internalId(), participant.telegramId());

        List<String> expiredSessionIds = new ArrayList<>();

        sessionRepository.findAllActiveByParticipant(participant.internalId())
                .flatMap(session -> mapSessionToListResponse(session, participant.internalId(), expiredSessionIds))
                .collectList()
                .doOnSuccess(sessions -> {
                    synchronized (expiredSessionIds) {
                        if (!expiredSessionIds.isEmpty()) {
                            cleanupExpiredSessions(new ArrayList<>(expiredSessionIds));
                        }
                    }
                })
                .subscribe(
                        sessions -> {
                            ActiveSessionsListEvent event = sessions.isEmpty()
                                    ? ActiveSessionsListEvent.empty()
                                    : ActiveSessionsListEvent.success(sessions);

                            if (principal instanceof AppPrincipal appPrincipal) {
                                sendActiveSessionsSnapshot(appPrincipal, event, "count=" + sessions.size());
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

    /**
     * Cleanup expired sessions from Redis (4.6.4).
     *
     * @param sessionIds list of session IDs to delete
     */
    private void cleanupExpiredSessions(List<String> sessionIds) {
        for (String sessionId : sessionIds) {
            sessionRepository.updateStatus(sessionId, SessionStatus.EXPIRED)
                    .then(sessionRepository.delete(sessionId))
                    .subscribe(
                            deleted -> LOG.info("Cleaned up expired session: {}", sessionId),
                            error -> LOG.error("Error cleaning up session {}: {}",
                                    sessionId, error.getMessage())
                );
        }
    }

    // ==================== Resume Session (4.6.3) ====================

    /**
     * Resume an existing session (4.6.3).
     *
     * <p>Called when a user reopens the Mini App and wants to continue
     * an existing session. Validates the session exists, is active,
     * and the user is a participant.
     *
     * <p>Destinations:
     * <ul>
     *   <li>Input: {@code /app/session.resume}</li>
     *   <li>Output: {@code /user/queue/session-resumed}</li>
     * </ul>
     *
     * @param request   the resume session request payload
     * @param principal authenticated user principal
     */
    @MessageMapping("/session.resume")
    public void resumeSession(@Payload ResumeSessionRequest request, Principal principal) {
        ParticipantContext participant = participantContext(principal);
        if (participant == null) {
            return;
        }
        String sessionId = request.sessionId();

        LOG.info("Session resume requested: sessionId={}, internalId={}, telegramId={}",
                sessionId, participant.internalId(), participant.telegramId());

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Session not found for resume: {}", sessionId);
                    sendResumeError(participant, sessionId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> validateAndResumeSession(session, participant))
                .subscribe(
                        result -> {},
                        error -> {
                            LOG.error("Error resuming session {}: {}", sessionId, error.getMessage());
                            sendResumeError(participant, sessionId, "INTERNAL_ERROR");
                        }
            );
    }

    private Mono<Void> validateAndResumeSession(Session session, ParticipantContext participant) {
        String sessionId = session.getId();

        if (!session.isParticipant(participant.internalId())) {
            LOG.debug("User {} is not participant in session {}", participant.internalId(), sessionId);
            sendResumeError(participant, sessionId, "NOT_PARTICIPANT");
            return Mono.empty();
        }

        if (session.getStatus() == SessionStatus.BURNED) {
            LOG.debug("Session {} is burned, cannot resume", sessionId);
            sendResumeEvent(participant, SessionResumedEvent.error(sessionId, "SESSION_BURNED"));
            return Mono.empty();
        }

        if (session.getStatus() == SessionStatus.EXPIRED || session.isExpired()) {
            LOG.debug("Session {} is expired, cannot resume", sessionId);
            return sessionRepository.updateStatus(sessionId, SessionStatus.EXPIRED)
                    .doOnSuccess(v -> sendResumeEvent(participant, SessionResumedEvent.expired(sessionId)))
                    .then();
        }

        return doResumeSession(session, participant);
    }

    private Mono<Void> doResumeSession(Session session, ParticipantContext participant) {
        String sessionId = session.getId();
        String peerInternalId = session.getPeerInternalId(participant.internalId());
        boolean isInitiator = session.isInitiator(participant.internalId());

        return sessionRepository.updateLastActivity(sessionId)
                .then(sessionRepository.refreshTtl(sessionId))
                .then(getUserResponseByInternalId(peerInternalId))
                .doOnSuccess(peerResponse -> {
                    SessionResponse sessionResponse = sessionMapper.toResponse(session, peerResponse, isInitiator);

                    SessionResumedEvent event = SessionResumedEvent.success(
                            sessionId,
                            sessionResponse,
                            session.getStatus(),
                            session.getExpiresAt(),
                            session.getRemainingSeconds(),
                            peerResponse.isOnline()
                    );

                    sendStompToInternalId(participant.internalId(), SESSION_RESUMED_DESTINATION, event);

                    LOG.info("Session resumed: sessionId={}, internalId={}, status={}, peerOnline={}",
                            sessionId, participant.internalId(), session.getStatus(), peerResponse.isOnline());
                })
                .then();
    }

    private void sendResumeError(ParticipantContext participant, String sessionId, String errorCode) {
        sendResumeEvent(participant, SessionResumedEvent.error(sessionId, errorCode));
    }

    private void sendResumeEvent(ParticipantContext participant, SessionResumedEvent event) {
        sendStompToInternalId(participant.internalId(), SESSION_RESUMED_DESTINATION, event);
    }
}

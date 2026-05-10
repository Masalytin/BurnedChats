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
import dev.burnedchats.model.TelegramUser;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.RequestRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.repository.UserRepository;
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

    private final SessionRepository sessionRepository;
    private final RequestRepository requestRepository;
    private final UserRepository userRepository;
    private final OnlineStatusRepository onlineStatusRepository;
    private final UserMapper userMapper;
    private final SessionMapper sessionMapper;
    private final StompUserMessenger stompUserMessenger;
    private final UserIdentityRepository userIdentityRepository;
    private final BurnedChatsBot telegramBot;
    private final BotMessageService botMessages;

    /**
     * Resolves {@link dev.burnedchats.model.UnifiedUser#internalId()} for STOMP user delivery by Telegram id.
     * Skips delivery with a warning when the mapping is missing.
     */
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
            TelegramPrincipal principal, ActiveSessionsListEvent event, String outcome) {
        stompUserMessenger.convertAndSendToUser(principal, ACTIVE_SESSIONS_DESTINATION, event);
        LOG.info("Sent active sessions list: internalId={}, telegramId={}, {}",
                principal.getInternalId(), principal.getUserId(), outcome);
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
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long initiatorId = telegramPrincipal.getUserId();
        Long recipientId = request.getRecipientId();
        String secretQuestion = normalizeOptionalText(request.getSecretQuestion());
        String secretExpectedAnswer = normalizeOptionalText(request.getSecretExpectedAnswer());

        LOG.info("Session creation requested: initiator={}, recipient={}, hasQuestion={}",
                initiatorId, recipientId, secretQuestion != null);

        // Validate: cannot create session with self
        if (initiatorId.equals(recipientId)) {
            LOG.debug("Self-request rejected for user {}", initiatorId);
            sendToInitiator(initiatorId, SessionCreatedEvent.error("SELF_REQUEST"));
            return;
        }

        if (secretQuestion != null) {
            if (secretExpectedAnswer == null) {
                LOG.debug("Secret question present without expected answer: initiator={}", initiatorId);
                sendToInitiator(initiatorId, SessionCreatedEvent.error("EXPECTED_ANSWER_REQUIRED"));
                return;
            }
            if (secretExpectedAnswer.length() > 256) {
                sendToInitiator(initiatorId, SessionCreatedEvent.error("EXPECTED_ANSWER_TOO_LONG"));
                return;
            }
        }

        // Validate and create session
        validateAndCreateSession(initiatorId, recipientId, secretQuestion, secretExpectedAnswer);
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

    /**
     * Validate constraints and create session if all checks pass.
     */
    private void validateAndCreateSession(Long initiatorId, Long recipientId, String secretQuestion,
                                          String secretExpectedAnswer) {
        // Check if initiator already has an active session
        sessionRepository.findActiveByParticipant(initiatorId)
                .flatMap(existingSession -> {
                    LOG.debug("Initiator {} already has active session: {}",
                            initiatorId, existingSession.getId());
                    return Mono.just(SessionCreatedEvent.error("ALREADY_HAS_SESSION"));
                })
                .switchIfEmpty(
                        // Check if recipient already has an active session
                        sessionRepository.findActiveByParticipant(recipientId)
                                .flatMap(existingSession -> {
                                    LOG.debug("Recipient {} already has active session: {}",
                                            recipientId, existingSession.getId());
                                    return Mono.just(SessionCreatedEvent.error("RECIPIENT_HAS_SESSION"));
                                })
                                .switchIfEmpty(
                                        // Check if there's already a pending request to this recipient from initiator
                                        requestRepository.existsBetween(initiatorId, recipientId)
                                                .flatMap(exists -> {
                                                    if (exists) {
                                                        LOG.debug("Pending request already exists: {} -> {}",
                                                                initiatorId, recipientId);
                                                        return Mono.just(SessionCreatedEvent.error(
                                                                "PENDING_REQUEST_EXISTS"));
                                                    }
                                                    // All validations passed - create session
                                                    return doCreateSession(initiatorId, recipientId, secretQuestion,
                                                            secretExpectedAnswer);
                                                })
                                )
                )
                .subscribe(
                        event -> sendToInitiator(initiatorId, event),
                        error -> {
                            LOG.error("Error creating session: initiator={}, recipient={}, error={}",
                                    initiatorId, recipientId, error.getMessage());
                            sendToInitiator(initiatorId, SessionCreatedEvent.error("INTERNAL_ERROR"));
                        }
            );
    }

    /**
     * Create the session and related entities after all validations pass.
     */
    private Mono<SessionCreatedEvent> doCreateSession(Long initiatorId, Long recipientId,
                                                      String secretQuestion, String secretExpectedAnswer) {
        // Get both users from cache
        return Mono.zip(
                userRepository.findById(initiatorId)
                        .switchIfEmpty(Mono.error(new IllegalStateException("Initiator not found in cache"))),
                userRepository.findById(recipientId)
                        .switchIfEmpty(Mono.just(createPlaceholderUser(recipientId)))
        ).flatMap(users -> {
            TelegramUser initiator = users.getT1();
            TelegramUser recipient = users.getT2();
            String sessionId = UUID.randomUUID().toString();
            Instant now = Instant.now();
            Session session = newPendingSession(
                    sessionId, initiatorId, recipientId, now, secretQuestion, secretExpectedAnswer);
            ChatRequest chatRequest = ChatRequest.fromSender(sessionId, initiator, recipientId, secretQuestion);

            // Save session and request
            return sessionRepository.save(session)
                    .then(requestRepository.save(chatRequest))
                    .then(onlineStatusRepository.isOnline(recipientId))
                    .flatMap(isRecipientOnline -> {
                        // Send incoming request event to recipient
                        sendIncomingRequestToRecipient(recipientId, sessionId, initiator,
                                secretQuestion, now, chatRequest.getExpiresAt());

                        // Send Telegram notification if recipient is not online
                        if (!isRecipientOnline) {
                            sendTelegramNotification(recipientId, recipient, initiator, sessionId);
                        }

                        // Build response for initiator
                        UserResponse recipientResponse = userMapper.toResponse(recipient, isRecipientOnline);

                        LOG.info("Session created successfully: sessionId={}, initiator={}, recipient={}, online={}",
                                sessionId, initiatorId, recipientId, isRecipientOnline);

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

    private static Session newPendingSession(String sessionId, Long initiatorId, Long recipientId, Instant now,
            String secretQuestion, String secretExpectedAnswer) {
        return Session.builder()
                .id(sessionId)
                .initiatorInternalId(InternalIds.forTelegramId(initiatorId))
                .initiatorTelegramId(initiatorId)
                .responderInternalId(InternalIds.forTelegramId(recipientId))
                .responderTelegramId(recipientId)
                .status(SessionStatus.PENDING)
                .createdAt(now)
                .lastActivityAt(now)
                .secretQuestion(secretQuestion)
                .secretAnswerHash(secretQuestion != null
                        ? SecretAnswerHasher.hash(secretExpectedAnswer)
                        : null)
                .build();
    }

    /**
     * Create a placeholder user for recipients not in cache.
     * This allows session creation even if we don't have cached user data.
     */
    private TelegramUser createPlaceholderUser(Long userId) {
        return TelegramUser.builder()
                .id(userId)
                .firstName("User")
                .build();
    }

    /**
     * Send incoming request event to recipient via WebSocket.
     */
    private void sendIncomingRequestToRecipient(Long recipientId, String sessionId,
                                                 TelegramUser sender, String secretQuestion,
                                                 Instant createdAt, Instant expiresAt) {
        UserResponse senderResponse = userMapper.toResponse(sender, true); // sender is online
        IncomingRequestEvent event = IncomingRequestEvent.create(
                sessionId, senderResponse, secretQuestion, createdAt, expiresAt
        );

        sendStompToTelegramUser(recipientId, INCOMING_REQUEST_DESTINATION, event);

        LOG.debug("Sent incoming request event to recipient {}: sessionId={}", recipientId, sessionId);
    }

    /**
     * Send Telegram notification to offline recipient.
     *
     * <p>The notification includes:
     * <ul>
     *   <li>Information about who sent the request</li>
     *   <li>Button to open Mini App with session context</li>
     * </ul>
     *
     * @param recipientId Telegram user ID of recipient
     * @param recipient   recipient's user info (used for language detection)
     * @param sender      sender's user info
     * @param sessionId   the session ID for deep linking
     */
    private void sendTelegramNotification(Long recipientId, TelegramUser recipient,
                                           TelegramUser sender, String sessionId) {
        botMessages.getForUser("bot.notify.chatRequest", recipientId)
                .subscribe(notificationText -> {
                    boolean sent = telegramBot.sendNotificationWithButton(
                            recipientId,
                            notificationText,
                            sessionId
                    );

                    if (sent) {
                        LOG.info("Telegram notification sent to recipient {}: sessionId={}", recipientId, sessionId);
                    } else {
                        LOG.warn("Failed to send Telegram notification to recipient {}", recipientId);
                    }
                });
    }

    /**
     * Send session created event to initiator.
     */
    private void sendToInitiator(Long initiatorId, SessionCreatedEvent event) {
        sendStompToTelegramUser(initiatorId, SESSION_CREATED_DESTINATION, event);

        LOG.trace("Sent session-created event to initiator {}: success={}, error={}",
                initiatorId, event.isSuccess(), event.getError());
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
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long userId = telegramPrincipal.getUserId();

        LOG.info("Pending requests requested: internalId={}, telegramId={}",
                telegramPrincipal.getInternalId(), userId);

        requestRepository.findByRecipient(userId)
                .flatMap(request -> buildIncomingRequestEvent(request)
                        .doOnNext(event -> {
                            stompUserMessenger.convertAndSendToUser(
                                    telegramPrincipal,
                                    INCOMING_REQUEST_DESTINATION,
                                    event
                            );
                            LOG.debug("Sent pending request to user {}: sessionId={}",
                                    userId, event.getSessionId());
                        }))
                .subscribe(
                        event -> {},
                        error -> LOG.error("Error sending pending requests to user {}: {}",
                                userId, error.getMessage()),
                        () -> LOG.debug("Finished sending pending requests to user {}", userId)
            );
    }

    /**
     * Build an IncomingRequestEvent from a ChatRequest.
     */
    private reactor.core.publisher.Mono<IncomingRequestEvent> buildIncomingRequestEvent(
            dev.burnedchats.model.ChatRequest request) {
        return userRepository.findById(request.getSenderTgId())
                .map(sender -> userMapper.toResponse(sender, true))
                .defaultIfEmpty(buildPlaceholderSender(request))
                .map(senderResponse -> IncomingRequestEvent.create(
                        request.getSessionId(),
                        senderResponse,
                        request.getQuestion(),
                        request.getCreatedAt(),
                        request.getExpiresAt()
                ));
    }

    /**
     * Build a placeholder sender response when user info is not cached.
     */
    private dev.burnedchats.dto.response.UserResponse buildPlaceholderSender(
            dev.burnedchats.model.ChatRequest request) {
        String displayName = request.getSenderFirstName();
        if (request.getSenderLastName() != null) {
            displayName += " " + request.getSenderLastName();
        }

        return dev.burnedchats.dto.response.UserResponse.builder()
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
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long responderId = telegramPrincipal.getUserId();
        String sessionId = request.getSessionId();

        LOG.info("Session accept requested: sessionId={}, responderId={}", sessionId, responderId);

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Session not found: {}", sessionId);
                    sendAcceptError(responderId, sessionId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> validateAndAcceptSession(session, responderId, request))
                .subscribe(
                        result -> {},
                        error -> {
                            LOG.error("Error accepting session {}: {}", sessionId, error.getMessage());
                            sendAcceptError(responderId, sessionId, "INTERNAL_ERROR");
                        }
            );
    }

    /**
     * Validate and process session acceptance.
     */
    private Mono<Void> validateAndAcceptSession(Session session, Long responderId,
                                                 AcceptSessionRequest request) {
        String sessionId = session.getId();

        // Validate user is the responder
        if (!responderId.equals(session.getResponderId())) {
            LOG.debug("User {} is not responder for session {}", responderId, sessionId);
            sendAcceptError(responderId, sessionId, "NOT_RESPONDER");
            return Mono.empty();
        }

        // Validate session status
        if (session.getStatus() != SessionStatus.PENDING) {
            LOG.debug("Session {} is not pending, status: {}", sessionId, session.getStatus());
            String errorCode = session.getStatus() == SessionStatus.HANDSHAKE
                    || session.getStatus() == SessionStatus.ACTIVE
                    ? "ALREADY_ACCEPTED" : "SESSION_EXPIRED";
            sendAcceptError(responderId, sessionId, errorCode);
            return Mono.empty();
        }

        // Check for secret question validation
        return requestRepository.findBySessionId(responderId, sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Request not found for session: {}", sessionId);
                    sendAcceptError(responderId, sessionId, "REQUEST_EXPIRED");
                    return Mono.empty();
                }))
                .flatMap(chatRequest -> {
                    // Validate secret answer if question exists
                    if (chatRequest.isHasQuestion()) {
                        String providedAnswer = request.getSecretAnswer();
                        if (providedAnswer == null || providedAnswer.isBlank()) {
                            LOG.debug("Secret answer required but not provided for session {}", sessionId);
                            sendAcceptError(responderId, sessionId, "ANSWER_REQUIRED");
                            return Mono.empty();
                        }
                        String expectedHash = session.getSecretAnswerHash();
                        if (expectedHash == null || expectedHash.isBlank()) {
                            LOG.warn("Session {} has secret question but missing expected answer hash", sessionId);
                            sendAcceptError(responderId, sessionId, "INTERNAL_ERROR");
                            return Mono.empty();
                        }
                        String providedHash = SecretAnswerHasher.hash(providedAnswer);
                        if (!SecretAnswerHasher.constantTimeEquals(providedHash, expectedHash)) {
                            LOG.debug("Wrong secret answer for session {}", sessionId);
                            sendAcceptError(responderId, sessionId, "WRONG_ANSWER");
                            return Mono.empty();
                        }
                        return doAcceptSession(session, chatRequest, responderId);
                    }
                    return doAcceptSession(session, chatRequest, responderId);
                });
    }

    /**
     * Process the acceptance after all validations pass.
     */
    private Mono<Void> doAcceptSession(Session session, ChatRequest chatRequest, Long responderId) {
        String sessionId = session.getId();
        Long initiatorId = session.getInitiatorId();
        Instant acceptedAt = Instant.now();

        // Update session status
        session.setStatus(SessionStatus.HANDSHAKE);
        session.setLastActivityAt(acceptedAt);

        return sessionRepository.save(session)
                .then(requestRepository.delete(responderId, sessionId))
                .then(Mono.zip(
                        getUserResponse(initiatorId),
                        getUserResponse(responderId)
                ))
                .doOnSuccess(users -> {
                    UserResponse initiatorInfo = users.getT1();
                    UserResponse responderInfo = users.getT2();

                    // Calculate session expiration (5.1.4)
                    Instant expiresAt = session.getExpiresAt();

                    // Send to initiator with responder info
                    SessionAcceptedEvent initiatorEvent = SessionAcceptedEvent.success(
                            sessionId, responderInfo, acceptedAt, expiresAt);
                    sendStompToTelegramUser(initiatorId, SESSION_ACCEPTED_DESTINATION, initiatorEvent);

                    // Send to responder with initiator info
                    SessionAcceptedEvent responderEvent = SessionAcceptedEvent.success(
                            sessionId, initiatorInfo, acceptedAt, expiresAt);
                    sendStompToTelegramUser(responderId, SESSION_ACCEPTED_DESTINATION, responderEvent);

                    LOG.info(
                            "Session accepted: sessionId={}, initiatorTelegramId={}, responderTelegramId={}, "
                                    + "expiresAt={}",
                            sessionId, initiatorId, responderId, expiresAt);
                })
                .then();
    }

    /**
     * Get user response for a participant.
     */
    private Mono<UserResponse> getUserResponse(Long userId) {
        return Mono.zip(
                userRepository.findById(userId)
                        .defaultIfEmpty(createPlaceholderUser(userId)),
                onlineStatusRepository.isOnline(userId)
        ).map(tuple -> userMapper.toResponse(tuple.getT1(), tuple.getT2()));
    }

    /**
     * Send accept error to responder.
     */
    private void sendAcceptError(Long responderId, String sessionId, String errorCode) {
        SessionAcceptedEvent event = SessionAcceptedEvent.error(sessionId, errorCode);
        sendStompToTelegramUser(responderId, SESSION_ACCEPTED_DESTINATION, event);
        LOG.trace("Sent accept error to responder {}: {}", responderId, errorCode);
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
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long userId = telegramPrincipal.getUserId();
        String sessionId = request.sessionId();

        LOG.debug("Session status check: sessionId={}, userId={}", sessionId, userId);

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    // Session not found (expired or never existed)
                    sendSessionStatus(telegramPrincipal, SessionStatusEvent.expired(sessionId));
                    return Mono.empty();
                }))
                .subscribe(
                        session -> {
                            // Validate user is participant
                            if (!session.isParticipant(userId)) {
                                var err = SessionStatusEvent.error(sessionId, "NOT_PARTICIPANT");
                                sendSessionStatus(telegramPrincipal, err);
                                return;
                            }

                            // Check if session is expired by status
                            if (session.getStatus() == SessionStatus.EXPIRED 
                                    || session.getStatus() == SessionStatus.BURNED) {
                                sendSessionStatus(telegramPrincipal, SessionStatusEvent.expired(sessionId));
                                return;
                            }

                            // Check TTL expiration
                            if (session.isExpired()) {
                                sendSessionStatus(telegramPrincipal, SessionStatusEvent.expired(sessionId));
                                return;
                            }

                            // Session is active
                            sendSessionStatus(telegramPrincipal, SessionStatusEvent.active(
                                    sessionId,
                                    session.getStatus(),
                                    session.getExpiresAt(),
                                    session.getRemainingSeconds()
                            ));
                        },
                        error -> {
                            LOG.error("Error checking session status: {}", error.getMessage());
                            sendSessionStatus(telegramPrincipal, SessionStatusEvent.error(sessionId, "INTERNAL_ERROR"));
                        }
            );
    }

    /**
     * Send session status event to user.
     */
    private void sendSessionStatus(TelegramPrincipal principal, SessionStatusEvent event) {
        stompUserMessenger.convertAndSendToUser(principal, SESSION_STATUS_DESTINATION, event);
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
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long userId = telegramPrincipal.getUserId();
        String sessionId = request.sessionId();

        LOG.info("Peer disconnect notification: sessionId={}, internalId={}, telegramId={}, reason={}",
                sessionId, telegramPrincipal.getInternalId(), userId, request.reason());

        sessionRepository.findById(sessionId)
                .subscribe(
                        session -> {
                            // Validate user is participant
                            if (!session.isParticipant(userId)) {
                                LOG.debug("User {} is not participant in session {}", userId, sessionId);
                                return;
                            }

                            // Get peer ID
                            Long peerId = session.getPeerId(userId);
                            if (peerId == null) {
                                return;
                            }

                            // Notify peer
                            PeerDisconnectedEvent event = PeerDisconnectedEvent.appClosed(sessionId, userId);
                            sendStompToTelegramUser(peerId, PEER_DISCONNECTED_DESTINATION, event);

                            LOG.info(
                                    "Peer disconnect notify: peerTelegramId={}, disconnectedInternalId={}, "
                                            + "disconnectedTelegramId={}, sessionId={}",
                                    peerId, telegramPrincipal.getInternalId(), userId, sessionId);
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
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long responderId = telegramPrincipal.getUserId();
        String sessionId = request.getSessionId();

        LOG.info("Session reject requested: sessionId={}, responderId={}", sessionId, responderId);

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Session not found for rejection: {}", sessionId);
                    // Silent fail - session may have already expired
                    return Mono.empty();
                }))
                .flatMap(session -> validateAndRejectSession(session, responderId))
                .subscribe(
                        result -> {},
                        error -> LOG.error("Error rejecting session {}: {}", sessionId, error.getMessage())
            );
    }

    /**
     * Validate and process session rejection.
     */
    private Mono<Void> validateAndRejectSession(Session session, Long responderId) {
        String sessionId = session.getId();

        // Validate user is the responder
        if (!responderId.equals(session.getResponderId())) {
            LOG.debug("User {} is not responder for session {}, cannot reject", responderId, sessionId);
            return Mono.empty();
        }

        // Validate session status - only PENDING sessions can be rejected
        if (session.getStatus() != SessionStatus.PENDING) {
            LOG.debug("Session {} is not pending, cannot reject. Status: {}", sessionId, session.getStatus());
            return Mono.empty();
        }

        return doRejectSession(session, responderId);
    }

    /**
     * Process the rejection after all validations pass.
     */
    private Mono<Void> doRejectSession(Session session, Long responderId) {
        String sessionId = session.getId();
        Long initiatorId = session.getInitiatorId();
        Instant rejectedAt = Instant.now();

        // Update session status to EXPIRED
        return sessionRepository.updateStatus(sessionId, SessionStatus.EXPIRED)
                .then(requestRepository.delete(responderId, sessionId))
                .doOnSuccess(v -> {
                    // Send rejection notification to initiator
                    SessionRejectedEvent event = SessionRejectedEvent.create(sessionId, rejectedAt);
                    sendStompToTelegramUser(initiatorId, SESSION_REJECTED_DESTINATION, event);

                    LOG.info("Session rejected: sessionId={}, initiatorTelegramId={}, responderTelegramId={}",
                            sessionId, initiatorId, responderId);
                })
                .then();
    }

    // ==================== Active Sessions (4.6.1, 4.6.2, 4.6.4) ====================

    private Mono<SessionResponse> mapSessionToListResponse(Session session, Long userId,
            List<String> expiredSessionIds) {
        if (session.isExpired()) {
            synchronized (expiredSessionIds) {
                expiredSessionIds.add(session.getId());
            }
            LOG.debug("Session {} is expired, marking for cleanup", session.getId());
            return Mono.<SessionResponse>empty();
        }

        Long peerId = session.getPeerId(userId);
        boolean isInitiator = userId.equals(session.getInitiatorId());

        return Mono.zip(
                userRepository.findById(peerId)
                        .defaultIfEmpty(createPlaceholderUser(peerId)),
                onlineStatusRepository.isOnline(peerId)
        ).map(tuple -> {
            UserResponse peerResponse = userMapper.toResponse(tuple.getT1(), tuple.getT2());
            return sessionMapper.toResponse(session, peerResponse, isInitiator);
        });
    }

    /**
     * Get list of active sessions for the authenticated user (4.6.1).
     *
     * <p>Returns all sessions where the user is a participant and the session
     * is not burned or expired. Also performs cleanup of expired sessions (4.6.4).
     *
     * <p>Destinations:
     * <ul>
     *   <li>Input: {@code /app/session.active.list}</li>
     *   <li>Output: {@code /user/queue/active-sessions}</li>
     * </ul>
     *
     * @param principal authenticated user principal
     */
    @MessageMapping("/session.active.list")
    public void getActiveSessions(Principal principal) {
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long userId = telegramPrincipal.getUserId();

        LOG.info("Getting active sessions: internalId={}, telegramId={}",
                telegramPrincipal.getInternalId(), userId);

        // Use concurrent list for thread-safe access from reactive streams
        List<String> expiredSessionIds = new ArrayList<>();

        sessionRepository.findAllActiveByParticipant(userId)
                .flatMap(session -> mapSessionToListResponse(session, userId, expiredSessionIds))
                .collectList()
                .doOnSuccess(sessions -> {
                    // 4.6.4: Cleanup expired sessions
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

                            sendActiveSessionsSnapshot(
                                    telegramPrincipal, event, "count=" + sessions.size());
                        },
                        error -> {
                            LOG.error("Error getting active sessions for user {}: {}",
                                    userId, error.getMessage());
                            sendActiveSessionsSnapshot(
                                    telegramPrincipal,
                                    ActiveSessionsListEvent.error("INTERNAL_ERROR"),
                                    "error=INTERNAL_ERROR");
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
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long userId = telegramPrincipal.getUserId();
        String sessionId = request.sessionId();

        LOG.info("Session resume requested: sessionId={}, internalId={}, telegramId={}",
                sessionId, telegramPrincipal.getInternalId(), userId);

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Session not found for resume: {}", sessionId);
                    sendResumeError(telegramPrincipal, sessionId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> validateAndResumeSession(session, telegramPrincipal))
                .subscribe(
                        result -> {},
                        error -> {
                            LOG.error("Error resuming session {}: {}", sessionId, error.getMessage());
                            sendResumeError(telegramPrincipal, sessionId, "INTERNAL_ERROR");
                        }
            );
    }

    /**
     * Validate and process session resume.
     */
    private Mono<Void> validateAndResumeSession(Session session, TelegramPrincipal principal) {
        Long userId = principal.getUserId();
        String sessionId = session.getId();

        // Validate user is a participant
        if (!session.isParticipant(userId)) {
            LOG.debug("User {} is not participant in session {}", userId, sessionId);
            sendResumeError(principal, sessionId, "NOT_PARTICIPANT");
            return Mono.empty();
        }

        // Check if session is burned or expired
        if (session.getStatus() == SessionStatus.BURNED) {
            LOG.debug("Session {} is burned, cannot resume", sessionId);
            sendResumeEvent(principal, SessionResumedEvent.error(sessionId, "SESSION_BURNED"));
            return Mono.empty();
        }

        if (session.getStatus() == SessionStatus.EXPIRED || session.isExpired()) {
            LOG.debug("Session {} is expired, cannot resume", sessionId);
            // Cleanup the expired session
            return sessionRepository.updateStatus(sessionId, SessionStatus.EXPIRED)
                    .doOnSuccess(v -> sendResumeEvent(principal, SessionResumedEvent.expired(sessionId)))
                    .then();
        }

        return doResumeSession(session, principal);
    }

    /**
     * Process session resume after validations pass.
     */
    private Mono<Void> doResumeSession(Session session, TelegramPrincipal principal) {
        Long userId = principal.getUserId();
        String sessionId = session.getId();
        Long peerId = session.getPeerId(userId);
        boolean isInitiator = userId.equals(session.getInitiatorId());

        // Update last activity and refresh TTL
        return sessionRepository.updateLastActivity(sessionId)
                .then(sessionRepository.refreshTtl(sessionId))
                .then(Mono.zip(
                        userRepository.findById(peerId)
                                .defaultIfEmpty(createPlaceholderUser(peerId)),
                        onlineStatusRepository.isOnline(peerId)
                ))
                .doOnSuccess(tuple -> {
                    TelegramUser peerUser = tuple.getT1();
                    boolean peerOnline = tuple.getT2();

                    UserResponse peerResponse = userMapper.toResponse(peerUser, peerOnline);
                    SessionResponse sessionResponse = sessionMapper.toResponse(session, peerResponse, isInitiator);

                    SessionResumedEvent event = SessionResumedEvent.success(
                            sessionId,
                            sessionResponse,
                            session.getStatus(),
                            session.getExpiresAt(),
                            session.getRemainingSeconds(),
                            peerOnline
                    );

                    stompUserMessenger.convertAndSendToUser(principal, SESSION_RESUMED_DESTINATION, event);

                    LOG.info("Session resumed: sessionId={}, internalId={}, telegramId={}, status={}, peerOnline={}",
                            sessionId, principal.getInternalId(), userId, session.getStatus(), peerOnline);
                })
                .then();
    }

    /**
     * Send resume error to user.
     */
    private void sendResumeError(TelegramPrincipal principal, String sessionId, String errorCode) {
        sendResumeEvent(principal, SessionResumedEvent.error(sessionId, errorCode));
    }

    /**
     * Send resume event to user.
     */
    private void sendResumeEvent(TelegramPrincipal principal, SessionResumedEvent event) {
        stompUserMessenger.convertAndSendToUser(principal, SESSION_RESUMED_DESTINATION, event);
    }
}

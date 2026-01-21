package dev.burnedchats.handler;

import dev.burnedchats.dto.event.IncomingRequestEvent;
import dev.burnedchats.dto.event.SessionAcceptedEvent;
import dev.burnedchats.dto.event.SessionCreatedEvent;
import dev.burnedchats.dto.event.SessionRejectedEvent;
import dev.burnedchats.dto.mapper.UserMapper;
import dev.burnedchats.dto.request.AcceptSessionRequest;
import dev.burnedchats.dto.request.CreateSessionRequest;
import dev.burnedchats.dto.request.RejectSessionRequest;
import dev.burnedchats.dto.response.UserResponse;
import dev.burnedchats.model.ChatRequest;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.model.TelegramUser;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.RequestRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.repository.UserRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.telegram.BurnedChatsBot;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.validation.annotation.Validated;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.Principal;
import java.time.Instant;
import java.util.Base64;
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
     * Emoji constants for Telegram notifications.
     */
    private static final String FIRE_EMOJI = "🔥";
    private static final String LOCK_EMOJI = "🔐";
    private static final String CLOCK_EMOJI = "⏰";

    private final SessionRepository sessionRepository;
    private final RequestRepository requestRepository;
    private final UserRepository userRepository;
    private final OnlineStatusRepository onlineStatusRepository;
    private final UserMapper userMapper;
    private final SimpMessagingTemplate messagingTemplate;
    private final BurnedChatsBot telegramBot;

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
        String secretQuestion = request.getSecretQuestion();

        log.info("Session creation requested: initiator={}, recipient={}, hasQuestion={}",
                initiatorId, recipientId, secretQuestion != null);

        // Validate: cannot create session with self
        if (initiatorId.equals(recipientId)) {
            log.debug("Self-request rejected for user {}", initiatorId);
            sendToInitiator(initiatorId, SessionCreatedEvent.error("SELF_REQUEST"));
            return;
        }

        // Validate and create session
        validateAndCreateSession(initiatorId, recipientId, secretQuestion);
    }

    /**
     * Validate constraints and create session if all checks pass.
     */
    private void validateAndCreateSession(Long initiatorId, Long recipientId, String secretQuestion) {
        // Check if initiator already has an active session
        sessionRepository.findActiveByParticipant(initiatorId)
                .flatMap(existingSession -> {
                    log.debug("Initiator {} already has active session: {}",
                            initiatorId, existingSession.getId());
                    return Mono.just(SessionCreatedEvent.error("ALREADY_HAS_SESSION"));
                })
                .switchIfEmpty(
                        // Check if recipient already has an active session
                        sessionRepository.findActiveByParticipant(recipientId)
                                .flatMap(existingSession -> {
                                    log.debug("Recipient {} already has active session: {}",
                                            recipientId, existingSession.getId());
                                    return Mono.just(SessionCreatedEvent.error("RECIPIENT_HAS_SESSION"));
                                })
                                .switchIfEmpty(
                                        // Check if there's already a pending request to this recipient from initiator
                                        requestRepository.existsBetween(initiatorId, recipientId)
                                                .flatMap(exists -> {
                                                    if (exists) {
                                                        log.debug("Pending request already exists: {} -> {}",
                                                                initiatorId, recipientId);
                                                        return Mono.just(SessionCreatedEvent.error(
                                                                "PENDING_REQUEST_EXISTS"));
                                                    }
                                                    // All validations passed - create session
                                                    return doCreateSession(initiatorId, recipientId, secretQuestion);
                                                })
                                )
                )
                .subscribe(
                        event -> sendToInitiator(initiatorId, event),
                        error -> {
                            log.error("Error creating session: initiator={}, recipient={}, error={}",
                                    initiatorId, recipientId, error.getMessage());
                            sendToInitiator(initiatorId, SessionCreatedEvent.error("INTERNAL_ERROR"));
                        }
                );
    }

    /**
     * Create the session and related entities after all validations pass.
     */
    private Mono<SessionCreatedEvent> doCreateSession(Long initiatorId, Long recipientId,
                                                       String secretQuestion) {
        // Get both users from cache
        return Mono.zip(
                userRepository.findById(initiatorId)
                        .switchIfEmpty(Mono.error(new IllegalStateException("Initiator not found in cache"))),
                userRepository.findById(recipientId)
                        .switchIfEmpty(Mono.just(createPlaceholderUser(recipientId)))
        ).flatMap(users -> {
            TelegramUser initiator = users.getT1();
            TelegramUser recipient = users.getT2();

            // Generate session ID
            String sessionId = UUID.randomUUID().toString();
            Instant now = Instant.now();

            // Create session
            Session session = Session.builder()
                    .id(sessionId)
                    .initiatorId(initiatorId)
                    .responderId(recipientId)
                    .status(SessionStatus.PENDING)
                    .createdAt(now)
                    .lastActivityAt(now)
                    .secretQuestion(secretQuestion)
                    .build();

            // Create chat request for recipient's queue
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
                            sendTelegramNotification(recipientId, initiator, sessionId);
                        }

                        // Build response for initiator
                        UserResponse recipientResponse = userMapper.toResponse(recipient, isRecipientOnline);

                        log.info("Session created successfully: sessionId={}, initiator={}, recipient={}, online={}",
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

        messagingTemplate.convertAndSendToUser(
                String.valueOf(recipientId),
                INCOMING_REQUEST_DESTINATION,
                event
        );

        log.debug("Sent incoming request event to recipient {}: sessionId={}", recipientId, sessionId);
    }

    /**
     * Send Telegram notification to offline recipient.
     *
     * <p>The notification includes:
     * <ul>
     *   <li>Information about who sent the request</li>
     *   <li>Expiration time warning</li>
     *   <li>Button to open Mini App with session context</li>
     * </ul>
     *
     * @param recipientId Telegram user ID of recipient
     * @param sender      sender's user info
     * @param sessionId   the session ID for deep linking
     */
    private void sendTelegramNotification(Long recipientId, TelegramUser sender, String sessionId) {
        String senderName = sender.getDisplayName();
        String senderUsername = sender.getUsername() != null
                ? " (@" + sender.getUsername() + ")"
                : "";

        String notificationText = String.format("""
                %s <b>Новый запрос на приватный чат</b>
                
                %s <b>%s</b>%s хочет начать защищённый диалог с вами.
                
                %s Запрос действителен 5 минут.
                
                Нажмите кнопку ниже, чтобы принять или отклонить запрос.
                """,
                FIRE_EMOJI, LOCK_EMOJI, senderName, senderUsername, CLOCK_EMOJI);

        // Send notification with deep link to session
        boolean sent = telegramBot.sendNotificationWithButton(
                recipientId,
                notificationText,
                sessionId
        );

        if (sent) {
            log.info("Telegram notification sent to recipient {}: sessionId={}", recipientId, sessionId);
        } else {
            log.warn("Failed to send Telegram notification to recipient {}", recipientId);
        }
    }

    /**
     * Send session created event to initiator.
     */
    private void sendToInitiator(Long initiatorId, SessionCreatedEvent event) {
        messagingTemplate.convertAndSendToUser(
                String.valueOf(initiatorId),
                SESSION_CREATED_DESTINATION,
                event
        );

        log.trace("Sent session-created event to initiator {}: success={}, error={}",
                initiatorId, event.isSuccess(), event.getError());
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

        log.info("Session accept requested: sessionId={}, responderId={}", sessionId, responderId);

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    log.debug("Session not found: {}", sessionId);
                    sendAcceptError(responderId, sessionId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> validateAndAcceptSession(session, responderId, request))
                .subscribe(
                        result -> {},
                        error -> {
                            log.error("Error accepting session {}: {}", sessionId, error.getMessage());
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
            log.debug("User {} is not responder for session {}", responderId, sessionId);
            sendAcceptError(responderId, sessionId, "NOT_RESPONDER");
            return Mono.empty();
        }

        // Validate session status
        if (session.getStatus() != SessionStatus.PENDING) {
            log.debug("Session {} is not pending, status: {}", sessionId, session.getStatus());
            String errorCode = session.getStatus() == SessionStatus.HANDSHAKE
                    || session.getStatus() == SessionStatus.ACTIVE
                    ? "ALREADY_ACCEPTED" : "SESSION_EXPIRED";
            sendAcceptError(responderId, sessionId, errorCode);
            return Mono.empty();
        }

        // Check for secret question validation
        return requestRepository.findBySessionId(responderId, sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    log.debug("Request not found for session: {}", sessionId);
                    sendAcceptError(responderId, sessionId, "REQUEST_EXPIRED");
                    return Mono.empty();
                }))
                .flatMap(chatRequest -> {
                    // Validate secret answer if question exists
                    if (chatRequest.isHasQuestion()) {
                        String providedAnswer = request.getSecretAnswer();
                        if (providedAnswer == null || providedAnswer.isBlank()) {
                            log.debug("Secret answer required but not provided for session {}", sessionId);
                            sendAcceptError(responderId, sessionId, "ANSWER_REQUIRED");
                            return Mono.empty();
                        }
                        // Store hashed answer for future verification
                        String answerHash = hashAnswer(providedAnswer);
                        return doAcceptSession(session, chatRequest, responderId, answerHash);
                    }
                    return doAcceptSession(session, chatRequest, responderId, null);
                });
    }

    /**
     * Process the acceptance after all validations pass.
     */
    private Mono<Void> doAcceptSession(Session session, ChatRequest chatRequest,
                                        Long responderId, String answerHash) {
        String sessionId = session.getId();
        Long initiatorId = session.getInitiatorId();
        Instant acceptedAt = Instant.now();

        // Update session status
        session.setStatus(SessionStatus.HANDSHAKE);
        session.setLastActivityAt(acceptedAt);
        if (answerHash != null) {
            session.setSecretAnswerHash(answerHash);
        }

        return sessionRepository.save(session)
                .then(requestRepository.delete(responderId, sessionId))
                .then(Mono.zip(
                        getUserResponse(initiatorId),
                        getUserResponse(responderId)
                ))
                .doOnSuccess(users -> {
                    UserResponse initiatorInfo = users.getT1();
                    UserResponse responderInfo = users.getT2();

                    // Send to initiator with responder info
                    SessionAcceptedEvent initiatorEvent = SessionAcceptedEvent.success(
                            sessionId, responderInfo, acceptedAt);
                    messagingTemplate.convertAndSendToUser(
                            String.valueOf(initiatorId),
                            SESSION_ACCEPTED_DESTINATION,
                            initiatorEvent
                    );

                    // Send to responder with initiator info
                    SessionAcceptedEvent responderEvent = SessionAcceptedEvent.success(
                            sessionId, initiatorInfo, acceptedAt);
                    messagingTemplate.convertAndSendToUser(
                            String.valueOf(responderId),
                            SESSION_ACCEPTED_DESTINATION,
                            responderEvent
                    );

                    log.info("Session accepted: sessionId={}, initiator={}, responder={}",
                            sessionId, initiatorId, responderId);
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
        messagingTemplate.convertAndSendToUser(
                String.valueOf(responderId),
                SESSION_ACCEPTED_DESTINATION,
                event
        );
        log.trace("Sent accept error to responder {}: {}", responderId, errorCode);
    }

    /**
     * Hash a secret answer using SHA-256.
     */
    private String hashAnswer(String answer) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(answer.toLowerCase().trim().getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash);
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is always available
            throw new RuntimeException("SHA-256 not available", e);
        }
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

        log.info("Session reject requested: sessionId={}, responderId={}", sessionId, responderId);

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    log.debug("Session not found for rejection: {}", sessionId);
                    // Silent fail - session may have already expired
                    return Mono.empty();
                }))
                .flatMap(session -> validateAndRejectSession(session, responderId))
                .subscribe(
                        result -> {},
                        error -> log.error("Error rejecting session {}: {}", sessionId, error.getMessage())
                );
    }

    /**
     * Validate and process session rejection.
     */
    private Mono<Void> validateAndRejectSession(Session session, Long responderId) {
        String sessionId = session.getId();

        // Validate user is the responder
        if (!responderId.equals(session.getResponderId())) {
            log.debug("User {} is not responder for session {}, cannot reject", responderId, sessionId);
            return Mono.empty();
        }

        // Validate session status - only PENDING sessions can be rejected
        if (session.getStatus() != SessionStatus.PENDING) {
            log.debug("Session {} is not pending, cannot reject. Status: {}", sessionId, session.getStatus());
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
                    messagingTemplate.convertAndSendToUser(
                            String.valueOf(initiatorId),
                            SESSION_REJECTED_DESTINATION,
                            event
                    );

                    log.info("Session rejected: sessionId={}, initiator={}, responder={}",
                            sessionId, initiatorId, responderId);
                })
                .then();
    }
}

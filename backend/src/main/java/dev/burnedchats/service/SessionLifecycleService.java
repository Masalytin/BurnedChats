package dev.burnedchats.service;

import dev.burnedchats.config.PowProperties;
import dev.burnedchats.dto.event.ActiveSessionsListEvent;
import dev.burnedchats.dto.event.IncomingRequestEvent;
import dev.burnedchats.dto.event.SessionAcceptedEvent;
import dev.burnedchats.dto.event.SessionCreatedEvent;
import dev.burnedchats.dto.event.SessionRejectedEvent;
import dev.burnedchats.dto.event.SessionResumedEvent;
import dev.burnedchats.dto.mapper.SessionMapper;
import dev.burnedchats.dto.mapper.UserMapper;
import dev.burnedchats.dto.request.AcceptSessionRequest;
import dev.burnedchats.dto.request.CreateSessionRequest;
import dev.burnedchats.dto.response.SessionResponse;
import dev.burnedchats.dto.response.UserResponse;
import dev.burnedchats.exception.PowInvalidException;
import dev.burnedchats.exception.PowRequiredException;
import dev.burnedchats.model.ChatRequest;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.RequestRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.security.pow.AdaptiveDifficultyService;
import dev.burnedchats.security.pow.PowAction;
import dev.burnedchats.security.pow.PowVerificationService;
import dev.burnedchats.service.RateLimitService.RateLimitType;
import dev.burnedchats.util.InternalIds;
import dev.burnedchats.util.ParticipantContext;
import dev.burnedchats.util.SecretAnswerHasher;
import dev.burnedchats.metrics.GrowthMetrics;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Business logic for DM session lifecycle: create, accept, reject, resume, and list.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@SuppressWarnings("checkstyle:LineLength")
public class SessionLifecycleService {

    private static final Pattern UUID_PATTERN = Pattern.compile(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    private final SessionRepository sessionRepository;
    private final RequestRepository requestRepository;
    private final OnlineStatusRepository onlineStatusRepository;
    private final UserMapper userMapper;
    private final SessionMapper sessionMapper;
    private final UserIdentityRepository userIdentityRepository;
    private final PowProperties powProperties;
    private final PowVerificationService powVerificationService;
    private final AdaptiveDifficultyService adaptiveDifficultyService;
    private final RateLimitService rateLimitService;

    @Autowired(required = false)
    private GrowthMetrics growthMetrics;

    public sealed interface CreateSessionResult permits CreateSessionResult.Created, CreateSessionResult.Failed {
        record Created(
                SessionCreatedEvent initiatorEvent,
                String recipientInternalId,
                IncomingRequestEvent recipientEvent,
                boolean recipientOnline,
                Long recipientTelegramId,
                UnifiedUser recipientUser,
                UnifiedUser initiatorUser,
                String sessionId
        ) implements CreateSessionResult {
        }

        record Failed(SessionCreatedEvent initiatorEvent) implements CreateSessionResult {
        }
    }

    public sealed interface AcceptSessionResult permits AcceptSessionResult.Accepted, AcceptSessionResult.Error {
        record Accepted(
                String initiatorInternalId,
                SessionAcceptedEvent initiatorEvent,
                String responderInternalId,
                SessionAcceptedEvent responderEvent
        ) implements AcceptSessionResult {
        }

        record Error(String responderInternalId, String sessionId, String errorCode) implements AcceptSessionResult {
        }
    }

    public record RejectSessionResult(String initiatorInternalId, SessionRejectedEvent event) {
    }

    public record ResumeSessionResult(SessionResumedEvent event) {
    }

    public record ActiveSessionsResult(ActiveSessionsListEvent event, List<String> expiredSessionIds) {
    }

    /**
     * PoW gate then Layer-0 rate limit before session business logic (DESIGN.md §6.2).
     */
    public Mono<Void> enforceSessionCreateGate(ParticipantContext initiator, CreateSessionRequest request) {
        Mono<Void> powGate = Mono.empty();
        if (powProperties.isEnabled()) {
            powGate = adaptiveDifficultyService.recordGatedAttempt()
                    .then(powVerificationService.verify(PowAction.SESSION_CREATE, request.getPow()))
                    .onErrorResume(PowRequiredException.class, e ->
                            adaptiveDifficultyService.recordRejected().then(Mono.error(e)))
                    .onErrorResume(PowInvalidException.class, e ->
                            adaptiveDifficultyService.recordRejected().then(Mono.error(e)));
        }
        return powGate.then(rateLimitService.enforceRateLimit(
                initiator.internalId(), RateLimitType.SESSION_CREATE));
    }

    public Mono<CreateSessionResult> createSession(ParticipantContext initiator, CreateSessionRequest request) {
        String secretQuestion = normalizeOptionalText(request.getSecretQuestion());
        String secretExpectedAnswer = normalizeOptionalText(request.getSecretExpectedAnswer());

        return resolveRecipientInternalId(request)
                .flatMap(recipientInternalId -> {
                    if (initiator.internalId().equals(recipientInternalId)) {
                        LOG.debug("Self-request rejected for user {}", initiator.internalId());
                        return Mono.just(new CreateSessionResult.Failed(
                                SessionCreatedEvent.error("SELF_REQUEST")));
                    }

                    if (secretQuestion != null) {
                        if (secretExpectedAnswer == null) {
                            LOG.debug("Secret question present without expected answer: initiator={}",
                                    initiator.internalId());
                            return Mono.just(new CreateSessionResult.Failed(
                                    SessionCreatedEvent.error("EXPECTED_ANSWER_REQUIRED")));
                        }
                        if (secretExpectedAnswer.length() > 256) {
                            return Mono.just(new CreateSessionResult.Failed(
                                    SessionCreatedEvent.error("EXPECTED_ANSWER_TOO_LONG")));
                        }
                    }

                    return validateAndCreateSession(initiator, recipientInternalId, secretQuestion,
                            secretExpectedAnswer);
                })
                .switchIfEmpty(Mono.fromSupplier(() -> new CreateSessionResult.Failed(
                        SessionCreatedEvent.error("INVALID_RECIPIENT"))))
                .doOnSuccess(result -> {
                    if (result instanceof CreateSessionResult.Created && growthMetrics != null) {
                        growthMetrics.incrementSessionsCreated();
                    }
                });
    }

    public Flux<IncomingRequestEvent> pendingIncomingRequests(ParticipantContext participant) {
        return requestRepository.findByRecipient(participant.internalId())
                .flatMap(this::buildIncomingRequestEvent);
    }

    public Mono<AcceptSessionResult> acceptSession(Session session, ParticipantContext responder,
                                                    AcceptSessionRequest request) {
        String sessionId = session.getId();

        if (!session.isResponder(responder.internalId())) {
            LOG.debug("User {} is not responder for session {}", responder.internalId(), sessionId);
            return Mono.just(new AcceptSessionResult.Error(
                    responder.internalId(), sessionId, "NOT_RESPONDER"));
        }

        if (session.getStatus() != SessionStatus.PENDING) {
            LOG.debug("Session {} is not pending, status: {}", sessionId, session.getStatus());
            String errorCode = session.getStatus() == SessionStatus.HANDSHAKE
                    || session.getStatus() == SessionStatus.ACTIVE
                    ? "ALREADY_ACCEPTED" : "SESSION_EXPIRED";
            return Mono.just(new AcceptSessionResult.Error(
                    responder.internalId(), sessionId, errorCode));
        }

        return requestRepository.findBySessionId(responder.internalId(), sessionId)
                .flatMap(chatRequest -> {
                    if (chatRequest.isHasQuestion()) {
                        String providedAnswer = request.getSecretAnswer();
                        if (providedAnswer == null || providedAnswer.isBlank()) {
                            LOG.debug("Secret answer required but not provided for session {}", sessionId);
                            return Mono.just(new AcceptSessionResult.Error(
                                    responder.internalId(), sessionId, "ANSWER_REQUIRED"));
                        }
                        String expectedHash = session.getSecretAnswerHash();
                        if (expectedHash == null || expectedHash.isBlank()) {
                            LOG.warn("Session {} has secret question but missing expected answer hash", sessionId);
                            return Mono.just(new AcceptSessionResult.Error(
                                    responder.internalId(), sessionId, "INTERNAL_ERROR"));
                        }
                        String providedHash = SecretAnswerHasher.hash(providedAnswer);
                        if (!SecretAnswerHasher.constantTimeEquals(providedHash, expectedHash)) {
                            LOG.debug("Wrong secret answer for session {}", sessionId);
                            return Mono.just(new AcceptSessionResult.Error(
                                    responder.internalId(), sessionId, "WRONG_ANSWER"));
                        }
                    }
                    return doAcceptSession(session, responder);
                })
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Request not found for session: {}", sessionId);
                    return Mono.just(new AcceptSessionResult.Error(
                            responder.internalId(), sessionId, "REQUEST_EXPIRED"));
                }));
    }

    public Mono<RejectSessionResult> rejectSession(Session session, ParticipantContext responder) {
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

    public Mono<ActiveSessionsResult> listActiveSessions(ParticipantContext participant) {
        List<String> expiredSessionIds = new ArrayList<>();

        return sessionRepository.findAllActiveByParticipant(participant.internalId())
                .flatMap(session -> mapSessionToListResponse(session, participant.internalId(), expiredSessionIds))
                .collectList()
                .map(sessions -> {
                    ActiveSessionsListEvent event = sessions.isEmpty()
                            ? ActiveSessionsListEvent.empty()
                            : ActiveSessionsListEvent.success(sessions);
                    return new ActiveSessionsResult(event, new ArrayList<>(expiredSessionIds));
                });
    }

    public Mono<Void> cleanupExpiredSessions(List<String> sessionIds) {
        return Flux.fromIterable(sessionIds)
                .flatMap(sessionId -> sessionRepository.updateStatus(sessionId, SessionStatus.EXPIRED)
                        .then(sessionRepository.delete(sessionId))
                        .doOnSuccess(v -> LOG.info("Cleaned up expired session: {}", sessionId))
                        .doOnError(error -> LOG.error("Error cleaning up session {}: {}",
                                sessionId, error.getMessage()))
                        .onErrorResume(e -> Mono.empty()))
                .then();
    }

    public Mono<ResumeSessionResult> resumeSession(Session session, ParticipantContext participant) {
        String sessionId = session.getId();

        if (!session.isParticipant(participant.internalId())) {
            LOG.debug("User {} is not participant in session {}", participant.internalId(), sessionId);
            return Mono.just(new ResumeSessionResult(
                    SessionResumedEvent.error(sessionId, "NOT_PARTICIPANT")));
        }

        if (session.getStatus() == SessionStatus.BURNED) {
            LOG.debug("Session {} is burned, cannot resume", sessionId);
            return Mono.just(new ResumeSessionResult(
                    SessionResumedEvent.error(sessionId, "SESSION_BURNED")));
        }

        if (session.getStatus() == SessionStatus.EXPIRED || session.isExpired()) {
            LOG.debug("Session {} is expired, cannot resume", sessionId);
            return sessionRepository.updateStatus(sessionId, SessionStatus.EXPIRED)
                    .thenReturn(new ResumeSessionResult(SessionResumedEvent.expired(sessionId)));
        }

        return doResumeSession(session, participant);
    }

    private Mono<CreateSessionResult> validateAndCreateSession(ParticipantContext initiator,
                                                               String recipientInternalId,
                                                               String secretQuestion,
                                                               String secretExpectedAnswer) {
        return sessionRepository.findActiveByParticipant(initiator.internalId())
                .flatMap(existingSession -> {
                    LOG.debug("Initiator {} already has active session: {}",
                            initiator.internalId(), existingSession.getId());
                    return Mono.<CreateSessionResult>just(new CreateSessionResult.Failed(
                            SessionCreatedEvent.error("ALREADY_HAS_SESSION")));
                })
                .switchIfEmpty(
                        sessionRepository.findActiveByParticipant(recipientInternalId)
                                .flatMap(existingSession -> {
                                    LOG.debug("Recipient {} already has active session: {}",
                                            recipientInternalId, existingSession.getId());
                                    return Mono.<CreateSessionResult>just(new CreateSessionResult.Failed(
                                            SessionCreatedEvent.error("RECIPIENT_HAS_SESSION")));
                                })
                                .switchIfEmpty(
                                        requestRepository.existsBetween(initiator.internalId(), recipientInternalId)
                                                .flatMap(exists -> {
                                                    if (exists) {
                                                        LOG.debug("Pending request already exists: {} -> {}",
                                                                initiator.internalId(), recipientInternalId);
                                                        return Mono.<CreateSessionResult>just(
                                                                new CreateSessionResult.Failed(
                                                                SessionCreatedEvent.error("PENDING_REQUEST_EXISTS")));
                                                    }
                                                    return doCreateSession(initiator, recipientInternalId,
                                                            secretQuestion, secretExpectedAnswer);
                                                })
                                )
                );
    }

    private Mono<CreateSessionResult> doCreateSession(ParticipantContext initiator,
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
                        UserResponse senderResponse = userMapper.toResponse(initiatorUser, true);
                        IncomingRequestEvent recipientEvent = IncomingRequestEvent.create(
                                sessionId, senderResponse, secretQuestion, now, chatRequest.getExpiresAt());

                        UserResponse recipientResponse = userMapper.toResponse(recipientUser, isRecipientOnline);

                        LOG.info("Session created successfully: sessionId={}, initiator={}, recipient={}, online={}",
                                sessionId, initiator.internalId(), recipientInternalId, isRecipientOnline);

                        SessionCreatedEvent initiatorEvent = SessionCreatedEvent.success(
                                sessionId,
                                recipientResponse,
                                secretQuestion != null && !secretQuestion.isBlank(),
                                now,
                                chatRequest.getExpiresAt());

                        return Mono.just(new CreateSessionResult.Created(
                                initiatorEvent,
                                recipientInternalId,
                                recipientEvent,
                                isRecipientOnline,
                                recipientUser.telegramId(),
                                recipientUser,
                                initiatorUser,
                                sessionId));
                    });
        });
    }

    private Mono<AcceptSessionResult> doAcceptSession(Session session, ParticipantContext responder) {
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
                .map(users -> {
                    UserResponse initiatorInfo = users.getT1();
                    UserResponse responderInfo = users.getT2();
                    Instant expiresAt = session.getExpiresAt();

                    SessionAcceptedEvent initiatorEvent = SessionAcceptedEvent.success(
                            sessionId, responderInfo, acceptedAt, expiresAt);
                    SessionAcceptedEvent responderEvent = SessionAcceptedEvent.success(
                            sessionId, initiatorInfo, acceptedAt, expiresAt);

                    LOG.info(
                            "Session accepted: sessionId={}, initiatorInternalId={}, responderInternalId={}, "
                                    + "expiresAt={}",
                            sessionId, initiatorInternalId, responder.internalId(), expiresAt);

                    return new AcceptSessionResult.Accepted(
                            initiatorInternalId,
                            initiatorEvent,
                            responder.internalId(),
                            responderEvent);
                });
    }

    private Mono<RejectSessionResult> doRejectSession(Session session, ParticipantContext responder) {
        String sessionId = session.getId();
        String initiatorInternalId = session.getInitiatorInternalId();
        Instant rejectedAt = Instant.now();

        return sessionRepository.updateStatus(sessionId, SessionStatus.EXPIRED)
                .then(requestRepository.delete(responder.internalId(), sessionId))
                .thenReturn(new RejectSessionResult(
                        initiatorInternalId,
                        SessionRejectedEvent.create(sessionId, rejectedAt)))
                .doOnSuccess(result -> LOG.info(
                        "Session rejected: sessionId={}, initiatorInternalId={}, responderInternalId={}",
                        sessionId, initiatorInternalId, responder.internalId()));
    }

    private Mono<ResumeSessionResult> doResumeSession(Session session, ParticipantContext participant) {
        String sessionId = session.getId();
        String peerInternalId = session.getPeerInternalId(participant.internalId());
        boolean isInitiator = session.isInitiator(participant.internalId());

        return sessionRepository.updateLastActivity(sessionId)
                .then(sessionRepository.refreshTtl(sessionId))
                .then(getUserResponseByInternalId(peerInternalId))
                .map(peerResponse -> {
                    SessionResponse sessionResponse = sessionMapper.toResponse(session, peerResponse, isInitiator);

                    SessionResumedEvent event = SessionResumedEvent.success(
                            sessionId,
                            sessionResponse,
                            session.getStatus(),
                            session.getExpiresAt(),
                            session.getRemainingSeconds(),
                            peerResponse.isOnline());

                    LOG.info("Session resumed: sessionId={}, internalId={}, status={}, peerOnline={}",
                            sessionId, participant.internalId(), session.getStatus(), peerResponse.isOnline());

                    return new ResumeSessionResult(event);
                });
    }

    private Mono<SessionResponse> mapSessionToListResponse(Session session, String userInternalId,
                                                             List<String> expiredSessionIds) {
        if (session.isExpired()) {
            synchronized (expiredSessionIds) {
                expiredSessionIds.add(session.getId());
            }
            LOG.debug("Session {} is expired, marking for cleanup", session.getId());
            return Mono.empty();
        }

        String peerInternalId = session.getPeerInternalId(userInternalId);
        boolean isInitiator = session.isInitiator(userInternalId);

        return getUserResponseByInternalId(peerInternalId)
                .map(peerResponse -> sessionMapper.toResponse(session, peerResponse, isInitiator));
    }

    private Mono<IncomingRequestEvent> buildIncomingRequestEvent(ChatRequest request) {
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

    private Mono<UserResponse> getUserResponseByInternalId(String internalId) {
        return Mono.zip(
                loadParticipant(internalId),
                onlineStatusRepository.isOnline(internalId)
        ).map(tuple -> userMapper.toResponse(tuple.getT1(), tuple.getT2()));
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

    private static String normalizeOptionalText(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    @SuppressWarnings("checkstyle:ParameterNumber")
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
}

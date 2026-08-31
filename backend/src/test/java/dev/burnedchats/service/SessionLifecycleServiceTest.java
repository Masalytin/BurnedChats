package dev.burnedchats.service;

import dev.burnedchats.config.PowProperties;
import dev.burnedchats.config.SessionProperties;
import dev.burnedchats.dto.mapper.SessionMapper;
import dev.burnedchats.dto.mapper.UserMapper;
import dev.burnedchats.dto.request.AcceptSessionRequest;
import dev.burnedchats.dto.request.CreateSessionRequest;
import dev.burnedchats.dto.response.SessionResponse;
import dev.burnedchats.dto.response.UserResponse;
import dev.burnedchats.model.ChatRequest;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.RequestRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.security.pow.AdaptiveDifficultyService;
import dev.burnedchats.security.pow.PowVerificationService;
import dev.burnedchats.service.SessionLifecycleService.AcceptSessionResult;
import dev.burnedchats.service.SessionLifecycleService.CreateSessionResult;
import dev.burnedchats.util.ParticipantContext;
import dev.burnedchats.util.SecretAnswerHasher;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("SessionLifecycleService")
class SessionLifecycleServiceTest {

    private static final String INITIATOR_ID = "11111111-1111-1111-1111-111111111111";
    private static final String RECIPIENT_ID = "22222222-2222-2222-2222-222222222222";
    private static final Long INITIATOR_TG = 100L;
    private static final Long RECIPIENT_TG = 200L;

    @Mock
    private SessionRepository sessionRepository;
    @Mock
    private RequestRepository requestRepository;
    @Mock
    private OnlineStatusRepository onlineStatusRepository;
    @Mock
    private UserMapper userMapper;
    @Mock
    private SessionMapper sessionMapper;
    @Mock
    private UserIdentityRepository userIdentityRepository;
    @Mock
    private PowProperties powProperties;
    @Mock
    private PowVerificationService powVerificationService;
    @Mock
    private AdaptiveDifficultyService adaptiveDifficultyService;
    @Mock
    private RateLimitService rateLimitService;

    private SessionLifecycleService service;

    @BeforeEach
    void setUp() {
        SessionProperties sessionProperties = new SessionProperties();
        sessionProperties.getRequest().setTtl(300);
        sessionProperties.getActive().setTtl(3600);
        service = new SessionLifecycleService(
                sessionRepository,
                requestRepository,
                onlineStatusRepository,
                userMapper,
                sessionMapper,
                userIdentityRepository,
                powProperties,
                powVerificationService,
                adaptiveDifficultyService,
                rateLimitService,
                sessionProperties
        );
        lenient().when(requestRepository.existsBetween(anyString(), anyString()))
                .thenReturn(Mono.just(false));
        lenient().when(sessionRepository.findActiveByParticipant(eq(RECIPIENT_ID)))
                .thenReturn(Mono.empty());
    }

    private static ParticipantContext initiator() {
        return new ParticipantContext(INITIATOR_ID, INITIATOR_TG, "initiator", "Initiator");
    }

    private static ParticipantContext recipient() {
        return new ParticipantContext(RECIPIENT_ID, RECIPIENT_TG, "recipient", "Recipient");
    }

    @Nested
    @DisplayName("createSession")
    class CreateSession {

        @Test
        @DisplayName("rejects self-request")
        void rejectsSelfRequest() {
            CreateSessionRequest request = CreateSessionRequest.builder()
                    .recipientInternalId(INITIATOR_ID)
                    .build();

            StepVerifier.create(service.createSession(initiator(), request))
                    .assertNext(result -> {
                        assertThat(result).isInstanceOf(CreateSessionResult.Failed.class);
                        CreateSessionResult.Failed failed = (CreateSessionResult.Failed) result;
                        assertThat(failed.initiatorEvent().getError()).isEqualTo("SELF_REQUEST");
                    })
                    .verifyComplete();

            verify(sessionRepository, never()).save(any());
        }

        @Test
        @DisplayName("rejects when initiator already has active session")
        void rejectsWhenInitiatorHasActiveSession() {
            CreateSessionRequest request = CreateSessionRequest.builder()
                    .recipientInternalId(RECIPIENT_ID)
                    .build();
            when(sessionRepository.findActiveByParticipant(eq(INITIATOR_ID)))
                    .thenReturn(Mono.just(Session.builder().id("existing").build()));

            StepVerifier.create(service.createSession(initiator(), request))
                    .expectNextMatches(result ->
                            result instanceof CreateSessionResult.Failed failed
                                    && "ALREADY_HAS_SESSION".equals(failed.initiatorEvent().getError()))
                    .verifyComplete();
        }

        @Test
        @DisplayName("does not return ALREADY_HAS_SESSION when findActive is empty after PENDING expiry")
        void afterExpiredPendingDoesNotReturnAlreadyHasSession() {
            CreateSessionRequest request = CreateSessionRequest.builder()
                    .recipientInternalId(RECIPIENT_ID)
                    .build();
            when(sessionRepository.findActiveByParticipant(eq(INITIATOR_ID))).thenReturn(Mono.empty());
            when(sessionRepository.findActiveByParticipant(eq(RECIPIENT_ID))).thenReturn(Mono.empty());
            when(userIdentityRepository.findById(INITIATOR_ID)).thenReturn(Mono.just(
                    new UnifiedUser(INITIATOR_ID, AuthType.TELEGRAM, "Initiator", INITIATOR_TG, null, null)));
            when(userIdentityRepository.findById(RECIPIENT_ID)).thenReturn(Mono.just(
                    new UnifiedUser(RECIPIENT_ID, AuthType.TELEGRAM, "Recipient", RECIPIENT_TG, null, null)));
            when(sessionRepository.save(any())).thenReturn(Mono.just(true));
            when(requestRepository.save(any())).thenReturn(Mono.just(1L));
            when(onlineStatusRepository.isOnline(RECIPIENT_ID)).thenReturn(Mono.just(false));
            when(userMapper.toResponse(any(UnifiedUser.class), anyBoolean()))
                    .thenReturn(UserResponse.builder().internalId(RECIPIENT_ID).build());

            StepVerifier.create(service.createSession(initiator(), request))
                    .assertNext(result -> {
                        assertThat(result).isInstanceOf(CreateSessionResult.Created.class);
                        assertThat(result).isNotInstanceOf(CreateSessionResult.Failed.class);
                    })
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("acceptSession")
    class AcceptSession {

        @Test
        @DisplayName("returns NOT_RESPONDER when caller is not responder")
        void notResponder() {
            Session session = pendingSession();
            AcceptSessionRequest request = AcceptSessionRequest.builder()
                    .sessionId(session.getId())
                    .build();

            StepVerifier.create(service.acceptSession(session, initiator(), request))
                    .assertNext(result -> {
                        assertThat(result).isInstanceOf(AcceptSessionResult.Error.class);
                        AcceptSessionResult.Error error = (AcceptSessionResult.Error) result;
                        assertThat(error.errorCode()).isEqualTo("NOT_RESPONDER");
                    })
                    .verifyComplete();
        }

        @Test
        @DisplayName("returns WRONG_ANSWER when secret answer does not match")
        void wrongSecretAnswer() {
            String answerHash = SecretAnswerHasher.hash("expected");
            Session session = pendingSessionWithSecret(answerHash);
            ChatRequest chatRequest = ChatRequest.builder()
                    .sessionId(session.getId())
                    .hasQuestion(true)
                    .build();

            when(requestRepository.findBySessionId(RECIPIENT_ID, session.getId()))
                    .thenReturn(Mono.just(chatRequest));

            AcceptSessionRequest request = AcceptSessionRequest.builder()
                    .sessionId(session.getId())
                    .secretAnswer("wrong")
                    .build();

            StepVerifier.create(service.acceptSession(session, recipient(), request))
                    .assertNext(result -> {
                        assertThat(result).isInstanceOf(AcceptSessionResult.Error.class);
                        assertThat(((AcceptSessionResult.Error) result).errorCode()).isEqualTo("WRONG_ANSWER");
                    })
                    .verifyComplete();

            verify(sessionRepository, never()).save(any());
        }
    }

    @Nested
    @DisplayName("rejectSession")
    class RejectSession {

        @Test
        @DisplayName("returns empty when session is not pending")
        void notPending() {
            Session session = pendingSession();
            session.setStatus(SessionStatus.HANDSHAKE);

            StepVerifier.create(service.rejectSession(session, recipient()))
                    .verifyComplete();

            verify(sessionRepository, never()).updateStatus(any(), any());
        }
    }

    @Nested
    @DisplayName("resumeSession")
    class ResumeSession {

        @Test
        @DisplayName("returns NOT_PARTICIPANT for outsider")
        void notParticipant() {
            Session session = activeSession();
            ParticipantContext outsider = new ParticipantContext(
                    "99999999-9999-9999-9999-999999999999", 999L, null, null);

            StepVerifier.create(service.resumeSession(session, outsider))
                    .assertNext(result -> assertThat(result.event().getError()).isEqualTo("NOT_PARTICIPANT"))
                    .verifyComplete();
        }

        @Test
        @DisplayName("expired PENDING returns SESSION_EXPIRED and cleans up")
        void expiredPendingReturnsSessionExpiredAndCleansUp() {
            Session expired = pendingSession();
            expired.setCreatedAt(Instant.now().minus(Duration.ofMinutes(6)));
            when(sessionRepository.updateStatus(expired.getId(), SessionStatus.EXPIRED))
                    .thenReturn(Mono.just(true));
            when(sessionRepository.delete(expired.getId())).thenReturn(Mono.just(1L));

            StepVerifier.create(service.resumeSession(expired, initiator()))
                    .assertNext(result -> {
                        assertThat(result.event().getError()).isEqualTo("SESSION_EXPIRED");
                        assertThat(result.pendingTimeouts()).hasSize(1);
                        assertThat(result.pendingTimeouts().get(0).initiatorInternalId())
                                .isEqualTo(INITIATOR_ID);
                    })
                    .verifyComplete();

            verify(sessionRepository).delete(expired.getId());
        }
    }

    @Nested
    @DisplayName("listActiveSessions")
    class ListActiveSessions {

        @Test
        @DisplayName("returns empty list when user has no active sessions")
        void emptyList() {
            when(sessionRepository.findAllActiveByParticipant(RECIPIENT_ID)).thenReturn(Flux.empty());

            StepVerifier.create(service.listActiveSessions(recipient()))
                    .assertNext(result -> {
                        assertThat(result.event().isSuccess()).isTrue();
                        assertThat(result.event().getCount()).isZero();
                        assertThat(result.expiredSessionIds()).isEmpty();
                    })
                    .verifyComplete();
        }

        @Test
        @DisplayName("PENDING older than request TTL is excluded and marked expired")
        void expiredPendingExcludedAndMarked() {
            Session expired = pendingSession();
            expired.setCreatedAt(Instant.now().minus(Duration.ofMinutes(6)));
            when(sessionRepository.findAllActiveByParticipant(INITIATOR_ID))
                    .thenReturn(Flux.just(expired));

            StepVerifier.create(service.listActiveSessions(initiator()))
                    .assertNext(result -> {
                        assertThat(result.event().getCount()).isZero();
                        assertThat(result.expiredSessionIds()).containsExactly(expired.getId());
                        assertThat(result.pendingTimeouts()).hasSize(1);
                        assertThat(result.pendingTimeouts().get(0).sessionId()).isEqualTo(expired.getId());
                        assertThat(result.pendingTimeouts().get(0).initiatorInternalId())
                                .isEqualTo(INITIATOR_ID);
                    })
                    .verifyComplete();
        }

        @Test
        @DisplayName("list SessionResponse includes isInitiator and expiresAt")
        void listIncludesIsInitiatorAndExpiresAt() {
            Session live = pendingSession();
            Instant expiresAt = live.getExpiresAt(Duration.ofSeconds(300));
            UserResponse peer = UserResponse.builder().internalId(RECIPIENT_ID).build();
            when(sessionRepository.findAllActiveByParticipant(INITIATOR_ID)).thenReturn(Flux.just(live));
            when(userIdentityRepository.findById(RECIPIENT_ID)).thenReturn(Mono.just(
                    new UnifiedUser(RECIPIENT_ID, AuthType.TELEGRAM, "Recipient", RECIPIENT_TG, null, null)));
            when(onlineStatusRepository.isOnline(RECIPIENT_ID)).thenReturn(Mono.just(true));
            when(userMapper.toResponse(any(UnifiedUser.class), anyBoolean())).thenReturn(peer);
            when(sessionMapper.toResponse(eq(live), eq(peer), eq(true), any(Duration.class)))
                    .thenReturn(SessionResponse.builder()
                            .sessionId(live.getId())
                            .isInitiator(true)
                            .expiresAt(expiresAt)
                            .build());

            StepVerifier.create(service.listActiveSessions(initiator()))
                    .assertNext(result -> {
                        assertThat(result.event().getSessions()).hasSize(1);
                        SessionResponse response = result.event().getSessions().get(0);
                        assertThat(response.isInitiator()).isTrue();
                        assertThat(response.getExpiresAt()).isEqualTo(expiresAt);
                    })
                    .verifyComplete();
        }

        @Test
        @DisplayName("expired ACTIVE cleanup does not emit pending timeout signal")
        void expiredActiveDoesNotEmitPendingTimeout() {
            Session expiredActive = activeSession();
            expiredActive.setCreatedAt(Instant.now().minus(Duration.ofMinutes(61)));
            when(sessionRepository.findAllActiveByParticipant(INITIATOR_ID))
                    .thenReturn(Flux.just(expiredActive));

            StepVerifier.create(service.listActiveSessions(initiator()))
                    .assertNext(result -> {
                        assertThat(result.event().getCount()).isZero();
                        assertThat(result.expiredSessionIds()).containsExactly(expiredActive.getId());
                        assertThat(result.pendingTimeouts()).isEmpty();
                    })
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("session expiry (IMP-DMPEND-03)")
    class SessionExpiry {

        private static final Duration REQUEST_TTL = Duration.ofSeconds(300);

        @Test
        @DisplayName("PENDING createdAt + 4 min is not expired")
        void pendingCreatedAtPlus4minIsNotExpired() {
            Session session = sessionAt(SessionStatus.PENDING, Duration.ofMinutes(4));

            assertThat(session.isExpired(REQUEST_TTL)).isFalse();
        }

        @Test
        @DisplayName("PENDING createdAt + 6 min is expired")
        void pendingCreatedAtPlus6minIsExpired() {
            Session session = sessionAt(SessionStatus.PENDING, Duration.ofMinutes(6));

            assertThat(session.isExpired(REQUEST_TTL)).isTrue();
        }

        @Test
        @DisplayName("ACTIVE createdAt + 6 min is not expired (blast-radius)")
        void activeCreatedAtPlus6minIsNotExpired() {
            Session session = sessionAt(SessionStatus.ACTIVE, Duration.ofMinutes(6));

            assertThat(session.isExpired(REQUEST_TTL)).isFalse();
        }

        @Test
        @DisplayName("HANDSHAKE createdAt + 6 min is not expired (blast-radius)")
        void handshakeCreatedAtPlus6minIsNotExpired() {
            Session session = sessionAt(SessionStatus.HANDSHAKE, Duration.ofMinutes(6));

            assertThat(session.isExpired(REQUEST_TTL)).isFalse();
        }

        private static Session sessionAt(SessionStatus status, Duration age) {
            Instant createdAt = Instant.now().minus(age);
            return Session.builder()
                    .id(UUID.randomUUID().toString())
                    .initiatorInternalId(INITIATOR_ID)
                    .initiatorTelegramId(INITIATOR_TG)
                    .responderInternalId(RECIPIENT_ID)
                    .responderTelegramId(RECIPIENT_TG)
                    .status(status)
                    .createdAt(createdAt)
                    .lastActivityAt(createdAt)
                    .build();
        }
    }

    private static Session pendingSession() {
        return Session.builder()
                .id(UUID.randomUUID().toString())
                .initiatorInternalId(INITIATOR_ID)
                .initiatorTelegramId(INITIATOR_TG)
                .responderInternalId(RECIPIENT_ID)
                .responderTelegramId(RECIPIENT_TG)
                .status(SessionStatus.PENDING)
                .createdAt(Instant.now())
                .lastActivityAt(Instant.now())
                .build();
    }

    private static Session pendingSessionWithSecret(String answerHash) {
        return Session.builder()
                .id(UUID.randomUUID().toString())
                .initiatorInternalId(INITIATOR_ID)
                .initiatorTelegramId(INITIATOR_TG)
                .responderInternalId(RECIPIENT_ID)
                .responderTelegramId(RECIPIENT_TG)
                .status(SessionStatus.PENDING)
                .createdAt(Instant.now())
                .lastActivityAt(Instant.now())
                .secretQuestion("Question?")
                .secretAnswerHash(answerHash)
                .build();
    }

    private static Session activeSession() {
        return Session.builder()
                .id(UUID.randomUUID().toString())
                .initiatorInternalId(INITIATOR_ID)
                .initiatorTelegramId(INITIATOR_TG)
                .responderInternalId(RECIPIENT_ID)
                .responderTelegramId(RECIPIENT_TG)
                .status(SessionStatus.ACTIVE)
                .createdAt(Instant.now())
                .lastActivityAt(Instant.now())
                .build();
    }
}

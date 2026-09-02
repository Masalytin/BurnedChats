package dev.burnedchats.service;

import dev.burnedchats.dto.event.PresenceEvent;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.repository.SessionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.messaging.simp.user.SimpUserRegistry;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("PresenceFanoutService")
class PresenceFanoutServiceTest {

    private static final String SUBJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    private static final String PEER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    private static final String STRANGER = "cccccccc-cccc-cccc-cccc-cccccccccccc";

    @Mock
    private SessionRepository sessionRepository;
    @Mock
    private StompUserMessenger stompUserMessenger;
    @Mock
    private ReactiveRedisTemplate<String, String> reactiveStringRedisTemplate;
    @Mock
    private SimpUserRegistry simpUserRegistry;

    private PresenceFanoutService fanout;

    @BeforeEach
    void setUp() {
        fanout = new PresenceFanoutService(
                sessionRepository,
                stompUserMessenger,
                reactiveStringRedisTemplate,
                simpUserRegistry
        );
        when(reactiveStringRedisTemplate.convertAndSend(anyString(), anyString()))
                .thenReturn(Mono.just(1L));
    }

    @Test
    @DisplayName("sends PresenceEvent to session peer only")
    void broadcastsToSessionPeerOnly() {
        when(sessionRepository.findAllActiveByParticipant(SUBJECT))
                .thenReturn(Flux.just(activeSession(SUBJECT, PEER)));

        StepVerifier.create(fanout.broadcast(SUBJECT, true))
                .verifyComplete();

        ArgumentCaptor<PresenceEvent> captor = ArgumentCaptor.forClass(PresenceEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(PEER), eq("/queue/presence"), captor.capture());
        assertThat(captor.getValue().getInternalId()).isEqualTo(SUBJECT);
        assertThat(captor.getValue().isOnline()).isTrue();
        assertThat(captor.getValue().getLastSeen() % 60_000L).isZero();

        verify(stompUserMessenger, never()).convertAndSendToInternalId(
                eq(STRANGER), anyString(), any());
        verify(stompUserMessenger, never()).convertAndSendToInternalId(
                eq(SUBJECT), anyString(), any());
    }

    @Test
    @DisplayName("does not notify burned or expired peers")
    void skipsBurnedSessions() {
        Session burned = activeSession(SUBJECT, PEER);
        burned.setStatus(SessionStatus.BURNED);
        when(sessionRepository.findAllActiveByParticipant(SUBJECT))
                .thenReturn(Flux.empty());

        StepVerifier.create(fanout.broadcast(SUBJECT, false))
                .verifyComplete();

        verify(stompUserMessenger, never()).convertAndSendToInternalId(
                anyString(), anyString(), any());
    }

    private static Session activeSession(String initiator, String responder) {
        return Session.builder()
                .id("session-1")
                .initiatorInternalId(initiator)
                .responderInternalId(responder)
                .status(SessionStatus.ACTIVE)
                .build();
    }
}

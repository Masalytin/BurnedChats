package dev.burnedchats.handler;

import dev.burnedchats.dto.request.PublicKeyRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.repository.MessageRepository;
import dev.burnedchats.repository.MessageRepository.RekeyQueueDropCounts;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.security.AppPrincipal;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for dropping stale offline queues when an ACTIVE DM session rekeys.
 */
@ExtendWith(MockitoExtension.class)
class HandshakeHandlerRekeyQueueDropTest {

    private static final String SESSION_ID = "550e8400-e29b-41d4-a716-446655440001";
    private static final String INITIATOR_ID = "11111111-1111-1111-1111-111111111111";
    private static final String RESPONDER_ID = "22222222-2222-2222-2222-222222222222";

    private static String keyA;
    private static String keyB;

    @Mock private SessionRepository sessionRepository;
    @Mock private MessageRepository messageRepository;
    @Mock private StompUserMessenger stompUserMessenger;
    @Mock private AppPrincipal responderPrincipal;

    private HandshakeHandler handler;

    @BeforeAll
    static void generateKeys() throws Exception {
        keyA = generateP256PublicKeyBase64();
        keyB = generateP256PublicKeyBase64();
    }

    @BeforeEach
    void setUp() {
        handler = new HandshakeHandler(sessionRepository, messageRepository, stompUserMessenger);
    }

    @Test
    void firstHandshakeDoesNotDropOfflineQueues() {
        when(responderPrincipal.getInternalId()).thenReturn(RESPONDER_ID);
        Session pending = sessionWithStatus(SessionStatus.HANDSHAKE).build();
        Session bothReady = sessionWithStatus(SessionStatus.HANDSHAKE)
                .initiatorPublicKey(keyA)
                .responderPublicKey(keyB)
                .build();

        when(sessionRepository.findById(SESSION_ID)).thenReturn(Mono.just(pending));
        when(sessionRepository.setPublicKeyAtomic(eq(SESSION_ID), eq(RESPONDER_ID), eq(keyB)))
                .thenReturn(Mono.just(bothReady));
        when(sessionRepository.clearPublicKeysAndSetActive(SESSION_ID)).thenReturn(Mono.just(true));

        handler.relayPublicKey(
                PublicKeyRequest.builder().sessionId(SESSION_ID).publicKey(keyB).build(),
                responderPrincipal);

        verify(messageRepository, never()).dropStaleOfflineQueuesForRekey(anyString(), anyString(), anyString());
        verify(sessionRepository, timeout(2000)).clearPublicKeysAndSetActive(SESSION_ID);
    }

    @Test
    void rekeyDropsStaleOfflineQueuesForBothParticipants() {
        when(responderPrincipal.getInternalId()).thenReturn(RESPONDER_ID);
        Session active = sessionWithStatus(SessionStatus.ACTIVE).build();
        Session bothReady = sessionWithStatus(SessionStatus.ACTIVE)
                .initiatorPublicKey(keyA)
                .responderPublicKey(keyB)
                .build();

        when(sessionRepository.findById(SESSION_ID)).thenReturn(Mono.just(active));
        when(sessionRepository.setPublicKeyAtomic(eq(SESSION_ID), eq(RESPONDER_ID), eq(keyB)))
                .thenReturn(Mono.just(bothReady));
        when(messageRepository.dropStaleOfflineQueuesForRekey(SESSION_ID, INITIATOR_ID, RESPONDER_ID))
                .thenReturn(Mono.just(new RekeyQueueDropCounts(2L, 1L)));
        when(sessionRepository.clearPublicKeysAndSetActive(SESSION_ID)).thenReturn(Mono.just(true));

        handler.relayPublicKey(
                PublicKeyRequest.builder().sessionId(SESSION_ID).publicKey(keyB).build(),
                responderPrincipal);

        verify(messageRepository, timeout(2000))
                .dropStaleOfflineQueuesForRekey(SESSION_ID, INITIATOR_ID, RESPONDER_ID);
        verify(sessionRepository, timeout(2000)).clearPublicKeysAndSetActive(SESSION_ID);
    }

    private static Session.SessionBuilder sessionWithStatus(SessionStatus status) {
        return Session.builder()
                .id(SESSION_ID)
                .initiatorInternalId(INITIATOR_ID)
                .responderInternalId(RESPONDER_ID)
                .status(status);
    }

    private static String generateP256PublicKeyBase64() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        KeyPair keyPair = generator.generateKeyPair();
        return Base64.getEncoder().encodeToString(keyPair.getPublic().getEncoded());
    }
}

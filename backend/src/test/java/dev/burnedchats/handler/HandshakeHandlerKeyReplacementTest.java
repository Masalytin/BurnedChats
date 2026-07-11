package dev.burnedchats.handler;

import dev.burnedchats.dto.request.PublicKeyRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
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

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for pending public-key replacement during HANDSHAKE / ACTIVE refresh.
 *
 * <p>Regression for fingerprint mismatch when a client retries with a new ECDH pair
 * after timeout/reconnect while the peer has not yet submitted a key.
 */
@ExtendWith(MockitoExtension.class)
class HandshakeHandlerKeyReplacementTest {

    private static final String SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";
    private static final String INITIATOR_ID = "11111111-1111-1111-1111-111111111111";
    private static final String RESPONDER_ID = "22222222-2222-2222-2222-222222222222";

    private static String keyA;
    private static String keyB;

    @Mock private SessionRepository sessionRepository;
    @Mock private StompUserMessenger stompUserMessenger;
    @Mock private AppPrincipal initiatorPrincipal;

    private HandshakeHandler handler;

    @BeforeAll
    static void generateKeys() throws Exception {
        keyA = generateP256PublicKeyBase64();
        keyB = generateP256PublicKeyBase64();
    }

    @BeforeEach
    void setUp() {
        handler = new HandshakeHandler(sessionRepository, stompUserMessenger);
        when(initiatorPrincipal.getInternalId()).thenReturn(INITIATOR_ID);
    }

    @Test
    void replacesPendingKeyWhenPeerHasNotSubmitted() {
        Session pending = handshakeSession()
                .initiatorPublicKey(keyA)
                .build();
        Session replaced = handshakeSession()
                .initiatorPublicKey(keyB)
                .build();

        when(sessionRepository.findById(SESSION_ID)).thenReturn(Mono.just(pending));
        when(sessionRepository.setPublicKeyAtomic(eq(SESSION_ID), eq(INITIATOR_ID), eq(keyB)))
                .thenReturn(Mono.just(replaced));

        handler.relayPublicKey(
                PublicKeyRequest.builder().sessionId(SESSION_ID).publicKey(keyB).build(),
                initiatorPrincipal);

        verify(sessionRepository, timeout(2000)).setPublicKeyAtomic(SESSION_ID, INITIATOR_ID, keyB);
        verify(stompUserMessenger, never()).convertAndSendToInternalId(
                anyString(), anyString(), any());
    }

    @Test
    void ignoresDuplicateWhenBothKeysAlreadyBuffered() {
        Session bothReady = handshakeSession()
                .initiatorPublicKey(keyA)
                .responderPublicKey(keyB)
                .build();

        when(sessionRepository.findById(SESSION_ID)).thenReturn(Mono.just(bothReady));

        String replacementKey = keyB;
        handler.relayPublicKey(
                PublicKeyRequest.builder().sessionId(SESSION_ID).publicKey(replacementKey).build(),
                initiatorPrincipal);

        verify(sessionRepository, timeout(500).times(1)).findById(SESSION_ID);
        verify(sessionRepository, never()).setPublicKeyAtomic(anyString(), anyString(), anyString());
    }

    private static Session.SessionBuilder handshakeSession() {
        return Session.builder()
                .id(SESSION_ID)
                .initiatorInternalId(INITIATOR_ID)
                .responderInternalId(RESPONDER_ID)
                .status(SessionStatus.HANDSHAKE);
    }

    private static String generateP256PublicKeyBase64() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        KeyPair keyPair = generator.generateKeyPair();
        return Base64.getEncoder().encodeToString(keyPair.getPublic().getEncoded());
    }
}

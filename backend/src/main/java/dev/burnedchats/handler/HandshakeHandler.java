package dev.burnedchats.handler;

import dev.burnedchats.dto.event.PeerPublicKeyEvent;
import dev.burnedchats.dto.request.PublicKeyRequest;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.messaging.StompUserMessenger;
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
import java.util.Base64;
import java.util.Map;

/**
 * STOMP handler for cryptographic handshake coordination.
 *
 * <p>Handles the ECDH key exchange between two participants during
 * the handshake phase. The server acts as a synchronized relay -
 * it buffers keys until both participants have submitted, then
 * relays both keys simultaneously. This prevents race conditions
 * where a client receives peer-key before being ready to process it.
 *
 * <p>Handshake flow:
 * <ol>
 *   <li>Session is accepted, status becomes HANDSHAKE</li>
 *   <li>Both clients generate ECDH P-256 key pairs</li>
 *   <li>Each client sends public key via {@code /app/handshake.key}</li>
 *   <li>Server buffers keys until both are received</li>
 *   <li>Server relays both keys simultaneously via PEER_PUBLIC_KEY events</li>
 *   <li>Each client imports peer's key and computes shared secret</li>
 *   <li>Session becomes ACTIVE after both keys are exchanged</li>
 * </ol>
 *
 * <p>Destinations:
 * <ul>
 *   <li>{@code /app/handshake.key} - submit public key for relay</li>
 * </ul>
 *
 * <p>Events sent:
 * <ul>
 *   <li>{@code /user/queue/peer-key} - peer's public key (PEER_PUBLIC_KEY)</li>
 * </ul>
 *
 * <p>Security considerations:
 * <ul>
 *   <li>Public keys are validated for Base64 format but not parsed</li>
 *   <li>Keys are buffered temporarily (transient) and cleared after relay</li>
 *   <li>Only session participants can exchange keys</li>
 *   <li>Session must be in HANDSHAKE status</li>
 * </ul>
 *
 * @see PublicKeyRequest
 * @see PeerPublicKeyEvent
 * @see dev.burnedchats.handler.SessionHandler
 */
@Slf4j
@Controller
@RequiredArgsConstructor
@Validated
public class HandshakeHandler {

    /**
     * STOMP destination for peer public key event.
     */
    private static final String PEER_KEY_DESTINATION = "/queue/peer-key";

    /**
     * STOMP destination for key refresh notification.
     * Sent to peer when one party initiates a key refresh for an ACTIVE session.
     */
    private static final String HANDSHAKE_REFRESH_DESTINATION = "/queue/handshake-refresh";

    /**
     * Minimum valid Base64-encoded SPKI public key length for P-256.
     */
    private static final int MIN_KEY_LENGTH = 44;

    /**
     * Maximum valid public key length (with some margin).
     */
    private static final int MAX_KEY_LENGTH = 256;

    private final SessionRepository sessionRepository;
    private final StompUserMessenger stompUserMessenger;

    /**
     * Relay a public key to the peer during handshake.
     *
     * @param request   the public key request containing sessionId and publicKey
     * @param principal authenticated user principal
     */
    @MessageMapping("/handshake.key")
    public void relayPublicKey(@Payload PublicKeyRequest request, Principal principal) {
        ParticipantContext sender = ParticipantContext.from(principal);
        if (sender == null) {
            LOG.warn("handshake.key: unsupported principal type {}", principal.getClass().getName());
            return;
        }
        String sessionId = request.getSessionId();
        String publicKey = request.getPublicKey();

        LOG.info("Public key relay requested: sessionId={}, internalId={}, keyLength={}",
                sessionId, sender.internalId(), publicKey != null ? publicKey.length() : 0);

        if (!isValidBase64Key(publicKey)) {
            LOG.warn("Invalid public key format from internalId={}: sessionId={}",
                    sender.internalId(), sessionId);
            sendError(principal, sessionId, "INVALID_KEY");
            return;
        }

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Session not found for handshake: {}", sessionId);
                    sendError(principal, sessionId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> validateAndRelayKey(session, sender, publicKey))
                .subscribe(
                        result -> { },
                        error -> {
                            LOG.error("Error relaying public key: sessionId={}, internalId={}, error={}",
                                    sessionId, sender.internalId(), error.getMessage());
                            sendError(principal, sessionId, "INTERNAL_ERROR");
                        }
            );
    }

    private Mono<Void> validateAndRelayKey(Session session, ParticipantContext sender, String publicKey) {
        String sessionId = session.getId();
        String senderInternalId = sender.internalId();

        if (!session.isParticipant(senderInternalId)) {
            LOG.debug("User {} is not a participant in session {}", senderInternalId, sessionId);
            sendError(sender, sessionId, "NOT_PARTICIPANT");
            return Mono.empty();
        }

        SessionStatus status = session.getStatus();
        if (status != SessionStatus.HANDSHAKE && status != SessionStatus.ACTIVE) {
            LOG.debug("Session {} is not in handshake/active status: {}", sessionId, status);
            String errorCode = status == SessionStatus.PENDING ? "SESSION_NOT_ACCEPTED"
                    : status == SessionStatus.BURNED ? "SESSION_BURNED"
                    : "INVALID_STATUS";
            sendError(sender, sessionId, errorCode);
            return Mono.empty();
        }

        if (session.getPublicKeyForUser(senderInternalId) != null) {
            LOG.debug("User {} already submitted key for session {}", senderInternalId, sessionId);
            return Mono.empty();
        }

        LOG.info("Public key received: sessionId={}, fromInternalId={}", sessionId, senderInternalId);

        return sessionRepository.setPublicKeyAtomic(sessionId, senderInternalId, publicKey)
                .flatMap(updatedSession -> afterPublicKeyAtomic(
                        session, senderInternalId, sessionId, status, updatedSession));
    }

    private Mono<Void> afterPublicKeyAtomic(Session session, String senderInternalId, String sessionId,
            SessionStatus status, Session updatedSession) {
        LOG.info("After atomic set: sessionId={}, bothReady={}",
                sessionId, updatedSession.areBothKeysReady());

        if (updatedSession.areBothKeysReady()) {
            String initiatorInternalId = updatedSession.getInitiatorInternalId();
            String responderInternalId = updatedSession.getResponderInternalId();
            Long initiatorTelegramId = updatedSession.getInitiatorTelegramId();
            Long responderTelegramId = updatedSession.getResponderTelegramId();
            String initiatorKey = updatedSession.getInitiatorPublicKey();
            String responderKey = updatedSession.getResponderPublicKey();
            Instant timestamp = Instant.now();

            sendPeerPublicKey(initiatorInternalId, initiatorTelegramId, sessionId,
                    responderInternalId, responderTelegramId, responderKey, timestamp);
            sendPeerPublicKey(responderInternalId, responderTelegramId, sessionId,
                    initiatorInternalId, initiatorTelegramId, initiatorKey, timestamp);

            LOG.info("Both public keys relayed: sessionId={}, initiator={}, responder={}",
                    sessionId, initiatorInternalId, responderInternalId);

            return sessionRepository.clearPublicKeysAndSetActive(sessionId)
                    .doOnSuccess(s -> LOG.info("Session {} is now ACTIVE", sessionId))
                    .then();
        }

        LOG.debug("Waiting for peer's key: sessionId={}", sessionId);

        if (status == SessionStatus.ACTIVE) {
            String peerInternalId = session.getPeerInternalId(senderInternalId);
            if (StringUtils.hasText(peerInternalId)) {
                sendKeyRefreshNotification(peerInternalId, sessionId);
            }
        }

        return Mono.empty();
    }

    private void sendPeerPublicKey(String recipientInternalId, Long recipientTelegramId,
            String sessionId, String peerInternalId, Long peerTelegramId,
            String publicKey, Instant timestamp) {
        if (!StringUtils.hasText(recipientInternalId)) {
            LOG.warn("PEER_PUBLIC_KEY skip: recipient internalId blank sessionId={}", sessionId);
            return;
        }
        PeerPublicKeyEvent event = PeerPublicKeyEvent.success(sessionId, peerTelegramId, publicKey, timestamp);
        stompUserMessenger.convertAndSendToInternalId(recipientInternalId, PEER_KEY_DESTINATION, event);
        LOG.debug(
                "Sent PEER_PUBLIC_KEY: recipientInternalId={}, recipientTelegramId={}, "
                        + "sessionId={}, peerInternalId={}, peerTelegramId={}",
                recipientInternalId, recipientTelegramId, sessionId, peerInternalId, peerTelegramId);
    }

    private void sendError(ParticipantContext participant, String sessionId, String errorCode) {
        PeerPublicKeyEvent event = PeerPublicKeyEvent.error(sessionId, errorCode);
        stompUserMessenger.convertAndSendToInternalId(
                participant.internalId(), PEER_KEY_DESTINATION, event);
        LOG.trace("Sent handshake error to internalId={}, telegramId={}, code={}",
                participant.internalId(), participant.telegramId(), errorCode);
    }

    private void sendError(Principal principal, String sessionId, String errorCode) {
        if (principal instanceof AppPrincipal appPrincipal) {
            stompUserMessenger.convertAndSendToUser(
                    appPrincipal, PEER_KEY_DESTINATION, PeerPublicKeyEvent.error(sessionId, errorCode));
        }
    }

    private void sendKeyRefreshNotification(String peerInternalId, String sessionId) {
        var notification = Map.of(
                "sessionId", sessionId,
                "type", "KEY_REFRESH_NEEDED"
        );
        stompUserMessenger.convertAndSendToInternalId(
                peerInternalId, HANDSHAKE_REFRESH_DESTINATION, notification);
        LOG.info("Sent key refresh notification: peerInternalId={}, sessionId={}",
                peerInternalId, sessionId);
    }

    private boolean isValidBase64Key(String publicKey) {
        if (publicKey == null || publicKey.isBlank()) {
            return false;
        }

        String trimmed = publicKey.trim();

        if (trimmed.length() < MIN_KEY_LENGTH || trimmed.length() > MAX_KEY_LENGTH) {
            return false;
        }

        try {
            byte[] decoded = Base64.getDecoder().decode(trimmed);
            return decoded.length >= 59 && decoded.length <= 200;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
}

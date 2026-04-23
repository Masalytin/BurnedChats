package dev.burnedchats.handler;

import dev.burnedchats.dto.event.PeerPublicKeyEvent;
import dev.burnedchats.dto.request.PublicKeyRequest;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
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
    private final SimpMessagingTemplate messagingTemplate;

    /**
     * Relay a public key to the peer during handshake.
     *
     * <p>This method receives a participant's ECDH public key and relays
     * it to the other participant in the session. The server does not
     * store or process the key - it only validates the session state
     * and participant identity.
     *
     * <p>Validation:
     * <ul>
     *   <li>Session must exist</li>
     *   <li>Session must be in HANDSHAKE status</li>
     *   <li>Sender must be a session participant</li>
     *   <li>Public key must be valid Base64</li>
     * </ul>
     *
     * @param request   the public key request containing sessionId and publicKey
     * @param principal authenticated user principal
     */
    @MessageMapping("/handshake.key")
    public void relayPublicKey(@Payload PublicKeyRequest request, Principal principal) {
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long senderId = telegramPrincipal.getUserId();
        String sessionId = request.getSessionId();
        String publicKey = request.getPublicKey();

        LOG.info("Public key relay requested: sessionId={}, senderId={}, keyLength={}",
                sessionId, senderId, publicKey != null ? publicKey.length() : 0);

        // Validate public key format before processing
        if (!isValidBase64Key(publicKey)) {
            LOG.warn("Invalid public key format from user {}: sessionId={}", senderId, sessionId);
            sendError(senderId, sessionId, "INVALID_KEY");
            return;
        }

        // Find session and relay key
        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Session not found for handshake: {}", sessionId);
                    sendError(senderId, sessionId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> validateAndRelayKey(session, senderId, publicKey))
                .subscribe(
                        result -> {},
                        error -> {
                            LOG.error("Error relaying public key: sessionId={}, senderId={}, error={}",
                                    sessionId, senderId, error.getMessage());
                            sendError(senderId, sessionId, "INTERNAL_ERROR");
                        }
            );
    }

    /**
     * Validate session state and handle the public key.
     *
     * <p>Uses synchronized exchange: keys are buffered until both participants
     * have submitted their keys, then both are relayed simultaneously.
     * This prevents race conditions where one client receives peer-key
     * before being ready to process it.
     *
     * <p>Uses atomic Redis operations to avoid lost updates when both
     * participants submit keys simultaneously.
     *
     * @param session   the session
     * @param senderId  the sender's user ID
     * @param publicKey the Base64-encoded public key
     * @return Mono completing when the key is processed
     */
    private Mono<Void> validateAndRelayKey(Session session, Long senderId, String publicKey) {
        String sessionId = session.getId();

        // Validate sender is a participant
        if (!session.isParticipant(senderId)) {
            LOG.debug("User {} is not a participant in session {}", senderId, sessionId);
            sendError(senderId, sessionId, "NOT_PARTICIPANT");
            return Mono.empty();
        }

        // Validate session status - must be HANDSHAKE (or ACTIVE for key refresh)
        SessionStatus status = session.getStatus();
        if (status != SessionStatus.HANDSHAKE && status != SessionStatus.ACTIVE) {
            LOG.debug("Session {} is not in handshake/active status: {}", sessionId, status);
            String errorCode = status == SessionStatus.PENDING ? "SESSION_NOT_ACCEPTED"
                    : status == SessionStatus.BURNED ? "SESSION_BURNED"
                    : "INVALID_STATUS";
            sendError(senderId, sessionId, errorCode);
            return Mono.empty();
        }

        // Check if user already submitted a key (prevent duplicate submissions)
        if (session.getPublicKeyForUser(senderId) != null) {
            LOG.debug("User {} already submitted key for session {}", senderId, sessionId);
            // Not an error - just ignore duplicate
            return Mono.empty();
        }

        LOG.info("Public key received: sessionId={}, from={}", sessionId, senderId);

        // Atomically set the public key and re-read session to check if both are ready
        return sessionRepository.setPublicKeyAtomic(sessionId, senderId, publicKey)
                .flatMap(updatedSession -> afterPublicKeyAtomic(session, senderId, sessionId, status, updatedSession));
    }

    private Mono<Void> afterPublicKeyAtomic(Session session, Long senderId, String sessionId,
            SessionStatus status, Session updatedSession) {
        LOG.info("After atomic set: sessionId={}, bothReady={}",
                sessionId, updatedSession.areBothKeysReady());

        if (updatedSession.areBothKeysReady()) {
            Long initiatorId = updatedSession.getInitiatorId();
            Long responderId = updatedSession.getResponderId();
            String initiatorKey = updatedSession.getInitiatorPublicKey();
            String responderKey = updatedSession.getResponderPublicKey();
            Instant timestamp = Instant.now();

            sendPeerPublicKey(initiatorId, sessionId, responderId, responderKey, timestamp);
            sendPeerPublicKey(responderId, sessionId, initiatorId, initiatorKey, timestamp);

            LOG.info("Both public keys relayed: sessionId={}, initiator={}, responder={}",
                    sessionId, initiatorId, responderId);

            return sessionRepository.clearPublicKeysAndSetActive(sessionId)
                    .doOnSuccess(s -> LOG.info("Session {} is now ACTIVE", sessionId))
                    .then();
        }

        LOG.debug("Waiting for peer's key: sessionId={}", sessionId);

        if (status == SessionStatus.ACTIVE) {
            Long peerId = session.getInitiatorId().equals(senderId)
                    ? session.getResponderId()
                    : session.getInitiatorId();
            sendKeyRefreshNotification(peerId, sessionId);
        }

        return Mono.empty();
    }

    /**
     * Send the PEER_PUBLIC_KEY event to a participant.
     *
     * @param recipientId the recipient's user ID
     * @param sessionId   the session ID
     * @param peerId      the peer's user ID (who sent the key)
     * @param publicKey   the peer's public key
     * @param timestamp   when the key was received
     */
    private void sendPeerPublicKey(Long recipientId, String sessionId, Long peerId,
                                    String publicKey, Instant timestamp) {
        PeerPublicKeyEvent event = PeerPublicKeyEvent.success(
                sessionId, peerId, publicKey, timestamp
        );

        messagingTemplate.convertAndSendToUser(
                String.valueOf(recipientId),
                PEER_KEY_DESTINATION,
                event
        );

        LOG.debug("Sent PEER_PUBLIC_KEY to user {}: sessionId={}, peerId={}",
                recipientId, sessionId, peerId);
    }

    /**
     * Send an error event to the sender.
     *
     * @param userId    the user ID to send the error to
     * @param sessionId the session ID (may be null)
     * @param errorCode the error code
     */
    private void sendError(Long userId, String sessionId, String errorCode) {
        PeerPublicKeyEvent event = PeerPublicKeyEvent.error(sessionId, errorCode);

        messagingTemplate.convertAndSendToUser(
                String.valueOf(userId),
                PEER_KEY_DESTINATION,
                event
        );

        LOG.trace("Sent handshake error to user {}: {}", userId, errorCode);
    }

    /**
     * Notify a peer that a key refresh is in progress for an ACTIVE session.
     *
     * <p>This is sent when one participant submits a new public key for a session
     * that is already ACTIVE (e.g., after reconnecting with lost keys). The peer
     * needs to also generate and submit a new key to complete the key refresh.
     *
     * @param peerId    the peer's user ID to notify
     * @param sessionId the session ID requiring key refresh
     */
    private void sendKeyRefreshNotification(Long peerId, String sessionId) {
        var notification = Map.of(
                "sessionId", sessionId,
                "type", "KEY_REFRESH_NEEDED"
        );

        messagingTemplate.convertAndSendToUser(
                String.valueOf(peerId),
                HANDSHAKE_REFRESH_DESTINATION,
                notification
        );

        LOG.info("Sent key refresh notification to user {} for session {}", peerId, sessionId);
    }

    /**
     * Validate that the public key is a valid Base64 string.
     *
     * <p>This performs basic format validation only. The actual
     * cryptographic validation happens on the client side when
     * importing the key.
     *
     * @param publicKey the public key string
     * @return true if valid Base64, false otherwise
     */
    private boolean isValidBase64Key(String publicKey) {
        if (publicKey == null || publicKey.isBlank()) {
            return false;
        }

        String trimmed = publicKey.trim();

        // Check length bounds
        if (trimmed.length() < MIN_KEY_LENGTH || trimmed.length() > MAX_KEY_LENGTH) {
            return false;
        }

        // Validate Base64 format
        try {
            byte[] decoded = Base64.getDecoder().decode(trimmed);
            // P-256 SPKI public key should be at least 59 bytes
            // (SPKI header + 65 bytes for uncompressed point)
            return decoded.length >= 59 && decoded.length <= 200;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
}

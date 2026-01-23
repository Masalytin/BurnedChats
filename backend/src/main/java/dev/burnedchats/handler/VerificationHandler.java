package dev.burnedchats.handler;

import dev.burnedchats.dto.event.VerificationEvent;
import dev.burnedchats.dto.request.VerificationRequest;
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

/**
 * STOMP handler for visual fingerprint verification.
 *
 * <p>Handles the fingerprint verification process where users confirm
 * that their visual fingerprints match. This provides protection against
 * man-in-the-middle (MITM) attacks by allowing out-of-band verification.
 *
 * <p>Verification flow:
 * <ol>
 *   <li>After handshake, both clients display the visual fingerprint</li>
 *   <li>Users compare fingerprints out-of-band (e.g., voice call)</li>
 *   <li>Each user confirms verification via {@code /app/verification.confirm}</li>
 *   <li>Server tracks verification status and notifies both parties</li>
 *   <li>When both verify, the session is marked as fully trusted</li>
 * </ol>
 *
 * <p>Destinations:
 * <ul>
 *   <li>{@code /app/verification.confirm} - confirm fingerprint verification</li>
 * </ul>
 *
 * <p>Events sent:
 * <ul>
 *   <li>{@code /user/queue/verification} - verification status updates</li>
 * </ul>
 *
 * <p>Security considerations:
 * <ul>
 *   <li>Only session participants can verify</li>
 *   <li>Session must be in ACTIVE status</li>
 *   <li>Verification is optional but recommended</li>
 *   <li>Negative verification (mismatch) triggers a warning</li>
 * </ul>
 *
 * @see VerificationRequest
 * @see VerificationEvent
 * @see dev.burnedchats.handler.HandshakeHandler
 */
@Slf4j
@Controller
@RequiredArgsConstructor
@Validated
public class VerificationHandler {

    /**
     * STOMP destination for verification events.
     */
    private static final String VERIFICATION_DESTINATION = "/queue/verification";

    private final SessionRepository sessionRepository;
    private final SimpMessagingTemplate messagingTemplate;

    /**
     * Confirm or deny fingerprint verification.
     *
     * <p>This method receives a participant's verification confirmation
     * and updates the session state. Both the confirming user and their
     * peer are notified of the verification status.
     *
     * <p>Validation:
     * <ul>
     *   <li>Session must exist</li>
     *   <li>Session must be in ACTIVE status</li>
     *   <li>User must be a session participant</li>
     * </ul>
     *
     * @param request   the verification request
     * @param principal authenticated user principal
     */
    @MessageMapping("/verification.confirm")
    public void confirmVerification(@Payload VerificationRequest request, Principal principal) {
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long userId = telegramPrincipal.getUserId();
        String sessionId = request.getSessionId();
        Boolean confirmed = request.getConfirmed();

        log.info("Verification confirmation received: sessionId={}, userId={}, confirmed={}",
                sessionId, userId, confirmed);

        // Handle negative verification (fingerprint mismatch)
        if (!confirmed) {
            handleMismatch(sessionId, userId);
            return;
        }

        // Find session and process verification
        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    log.debug("Session not found for verification: {}", sessionId);
                    sendError(userId, sessionId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> validateAndConfirm(session, userId))
                .subscribe(
                        result -> {},
                        error -> {
                            log.error("Error processing verification: sessionId={}, userId={}, error={}",
                                    sessionId, userId, error.getMessage());
                            sendError(userId, sessionId, "INTERNAL_ERROR");
                        }
                );
    }

    /**
     * Validate session state and confirm verification.
     *
     * @param session the session
     * @param userId  the user's ID
     * @return Mono completing when verification is processed
     */
    private Mono<Void> validateAndConfirm(Session session, Long userId) {
        String sessionId = session.getId();

        // Validate user is a participant
        if (!session.isParticipant(userId)) {
            log.debug("User {} is not a participant in session {}", userId, sessionId);
            sendError(userId, sessionId, "NOT_PARTICIPANT");
            return Mono.empty();
        }

        // Validate session status - must be ACTIVE or HANDSHAKE
        SessionStatus status = session.getStatus();
        if (status != SessionStatus.ACTIVE && status != SessionStatus.HANDSHAKE) {
            log.debug("Session {} is not active for verification: {}", sessionId, status);
            String errorCode = status == SessionStatus.BURNED ? "SESSION_BURNED"
                    : status == SessionStatus.PENDING ? "SESSION_NOT_READY"
                    : "SESSION_NOT_ACTIVE";
            sendError(userId, sessionId, errorCode);
            return Mono.empty();
        }

        // Determine which participant verified
        boolean isInitiator = userId.equals(session.getInitiatorId());
        boolean wasInitiatorVerified = session.isInitiatorVerified();
        boolean wasResponderVerified = session.isResponderVerified();

        // Update verification status
        if (isInitiator) {
            session.setInitiatorVerified(true);
        } else {
            session.setResponderVerified(true);
        }

        // Check if both are now verified
        boolean bothVerified = session.isInitiatorVerified() && session.isResponderVerified();

        session.touch();

        return sessionRepository.save(session)
                .doOnSuccess(savedSession -> {
                    Instant now = Instant.now();
                    Long peerId = session.getPeerId(userId);

                    // Send confirmation to the verifying user
                    sendVerificationStatus(userId, sessionId, true, 
                            isInitiator ? wasResponderVerified : wasInitiatorVerified, now);

                    // Notify peer about the verification
                    if (peerId != null) {
                        sendPeerVerified(peerId, sessionId, bothVerified);
                    }

                    log.info("Verification confirmed: sessionId={}, userId={}, bothVerified={}",
                            sessionId, userId, bothVerified);
                })
                .then();
    }

    /**
     * Handle fingerprint mismatch report.
     * This is a security-critical event that may indicate a MITM attack.
     *
     * @param sessionId the session ID
     * @param userId    the reporting user's ID
     */
    private void handleMismatch(String sessionId, Long userId) {
        log.warn("SECURITY: Fingerprint mismatch reported! sessionId={}, userId={}",
                sessionId, userId);

        sessionRepository.findById(sessionId)
                .subscribe(
                        session -> {
                            if (session != null && session.isParticipant(userId)) {
                                Long peerId = session.getPeerId(userId);

                                // Notify both parties about the mismatch
                                sendMismatch(userId, sessionId);
                                if (peerId != null) {
                                    sendMismatch(peerId, sessionId);
                                }

                                log.warn("SECURITY: Mismatch notifications sent for session {}",
                                        sessionId);
                            }
                        },
                        error -> log.error("Error handling mismatch: {}", error.getMessage())
                );
    }

    /**
     * Send verification status to a user.
     */
    private void sendVerificationStatus(Long userId, String sessionId, 
                                         boolean verified, boolean peerVerified, Instant timestamp) {
        VerificationEvent event = VerificationEvent.success(sessionId, verified, peerVerified, timestamp);

        messagingTemplate.convertAndSendToUser(
                String.valueOf(userId),
                VERIFICATION_DESTINATION,
                event
        );

        log.debug("Sent verification status to user {}: sessionId={}, verified={}, peerVerified={}",
                userId, sessionId, verified, peerVerified);
    }

    /**
     * Notify a user that their peer has verified.
     */
    private void sendPeerVerified(Long userId, String sessionId, boolean bothVerified) {
        VerificationEvent event = VerificationEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .peerVerified(true)
                .bothVerified(bothVerified)
                .verifiedAt(Instant.now())
                .build();

        messagingTemplate.convertAndSendToUser(
                String.valueOf(userId),
                VERIFICATION_DESTINATION,
                event
        );

        log.debug("Sent peer verified notification to user {}: sessionId={}, bothVerified={}",
                userId, sessionId, bothVerified);
    }

    /**
     * Send fingerprint mismatch warning to a user.
     */
    private void sendMismatch(Long userId, String sessionId) {
        VerificationEvent event = VerificationEvent.mismatch(sessionId);

        messagingTemplate.convertAndSendToUser(
                String.valueOf(userId),
                VERIFICATION_DESTINATION,
                event
        );

        log.debug("Sent mismatch warning to user {}: sessionId={}", userId, sessionId);
    }

    /**
     * Send an error event to a user.
     */
    private void sendError(Long userId, String sessionId, String errorCode) {
        VerificationEvent event = VerificationEvent.error(sessionId, errorCode);

        messagingTemplate.convertAndSendToUser(
                String.valueOf(userId),
                VERIFICATION_DESTINATION,
                event
        );

        log.trace("Sent verification error to user {}: {}", userId, errorCode);
    }
}

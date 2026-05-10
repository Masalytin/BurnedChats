package dev.burnedchats.handler;

import dev.burnedchats.dto.event.VerificationEvent;
import dev.burnedchats.dto.request.VerificationRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
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
    private final StompUserMessenger stompUserMessenger;
    private final UserIdentityRepository userIdentityRepository;

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

        LOG.info("Verification confirmation received: sessionId={}, userId={}, confirmed={}",
                sessionId, userId, confirmed);

        // Handle negative verification (fingerprint mismatch)
        if (!confirmed) {
            handleMismatch(sessionId, telegramPrincipal);
            return;
        }

        // Find session and process verification
        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Session not found for verification: {}", sessionId);
                    sendError(telegramPrincipal, sessionId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> validateAndConfirm(session, telegramPrincipal))
                .subscribe(
                        result -> {},
                        error -> {
                            LOG.error("Error processing verification: sessionId={}, userTelegramId={}, error={}",
                                    sessionId, userId, error.getMessage());
                            sendError(telegramPrincipal, sessionId, "INTERNAL_ERROR");
                        }
            );
    }

    /**
     * Validate session state and confirm verification.
     *
     * @param session   the session
     * @param principal authenticated user
     * @return Mono completing when verification is processed
     */
    private Mono<Void> validateAndConfirm(Session session, TelegramPrincipal principal) {
        Long userId = principal.getUserId();
        String sessionId = session.getId();

        // Validate user is a participant
        if (!session.isParticipant(userId)) {
            LOG.debug("User {} is not a participant in session {}", userId, sessionId);
            sendError(principal, sessionId, "NOT_PARTICIPANT");
            return Mono.empty();
        }

        // Validate session status - must be ACTIVE or HANDSHAKE
        SessionStatus status = session.getStatus();
        if (status != SessionStatus.ACTIVE && status != SessionStatus.HANDSHAKE) {
            LOG.debug("Session {} is not active for verification: {}", sessionId, status);
            String errorCode = status == SessionStatus.BURNED ? "SESSION_BURNED"
                    : status == SessionStatus.PENDING ? "SESSION_NOT_READY"
                    : "SESSION_NOT_ACTIVE";
            sendError(principal, sessionId, errorCode);
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
                    Long peerTelegramId = session.getPeerId(userId);

                    // Send confirmation to the verifying user
                    sendVerificationStatus(principal, sessionId, true,
                            isInitiator ? wasResponderVerified : wasInitiatorVerified, now);

                    // Notify peer about the verification
                    if (peerTelegramId != null) {
                        sendPeerVerified(peerTelegramId, sessionId, bothVerified);
                    }

                    LOG.info("Verification confirmed: sessionId={}, userTelegramId={}, bothVerified={}",
                            sessionId, userId, bothVerified);
                })
                .then();
    }

    /**
     * Handle fingerprint mismatch report.
     * This is a security-critical event that may indicate a MITM attack.
     *
     * @param sessionId the session ID
     * @param reporter  authenticated user reporting the mismatch
     */
    private void handleMismatch(String sessionId, TelegramPrincipal reporter) {
        Long userTelegramId = reporter.getUserId();
        LOG.warn("SECURITY: Fingerprint mismatch reported! sessionId={}, userTelegramId={}",
                sessionId, userTelegramId);

        sessionRepository.findById(sessionId)
                .subscribe(
                        session -> {
                            if (session != null && session.isParticipant(userTelegramId)) {
                                Long peerTelegramId = session.getPeerId(userTelegramId);

                                sendMismatch(reporter, sessionId);
                                if (peerTelegramId != null) {
                                    sendMismatchToPeer(peerTelegramId, sessionId);
                                }

                                LOG.warn("SECURITY: Mismatch notifications sent for session {}",
                                        sessionId);
                            }
                        },
                        error -> LOG.error("Error handling mismatch: {}", error.getMessage())
            );
    }

    /**
     * Send verification status to the verifying user (authenticated principal).
     */
    private void sendVerificationStatus(TelegramPrincipal principal, String sessionId,
            boolean verified, boolean peerVerified, Instant timestamp) {
        VerificationEvent event = VerificationEvent.success(sessionId, verified, peerVerified, timestamp);

        stompUserMessenger.convertAndSendToUser(principal, VERIFICATION_DESTINATION, event);

        LOG.debug(
                "Sent verification status: userTelegramId={}, internalId={}, sessionId={}, "
                        + "verified={}, peerVerified={}",
                principal.getUserId(), principal.getInternalId(), sessionId, verified, peerVerified);
    }

    /**
     * Notify a peer (by Telegram id) that the other party has verified.
     */
    private void sendPeerVerified(Long peerTelegramId, String sessionId, boolean bothVerified) {
        VerificationEvent event = VerificationEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .peerVerified(true)
                .bothVerified(bothVerified)
                .verifiedAt(Instant.now())
                .build();

        sendVerificationToTelegramPeer(peerTelegramId, event);
        LOG.debug("Sent peer verified notification: peerTelegramId={}, sessionId={}, bothVerified={}",
                peerTelegramId, sessionId, bothVerified);
    }

    private void sendVerificationToTelegramPeer(Long peerTelegramId, VerificationEvent event) {
        userIdentityRepository.findByTelegramId(peerTelegramId)
                .filter(StringUtils::hasText)
                .doOnNext(peerInternalId -> {
                    stompUserMessenger.convertAndSendToInternalId(
                            peerInternalId, VERIFICATION_DESTINATION, event);
                    LOG.debug("Verification STOMP to peer: peerTelegramId={}, peerInternalId={}",
                            peerTelegramId, peerInternalId);
                })
                .switchIfEmpty(Mono.fromRunnable(() -> LOG.warn(
                        "Verification STOMP skipped: no UserIdentity for peerTelegramId={}", peerTelegramId)))
                .subscribe();
    }

    /**
     * Send fingerprint mismatch warning to the reporting user.
     */
    private void sendMismatch(TelegramPrincipal reporter, String sessionId) {
        VerificationEvent event = VerificationEvent.mismatch(sessionId);

        stompUserMessenger.convertAndSendToUser(reporter, VERIFICATION_DESTINATION, event);

        LOG.debug("Sent mismatch warning: userTelegramId={}, internalId={}, sessionId={}",
                reporter.getUserId(), reporter.getInternalId(), sessionId);
    }

    private void sendMismatchToPeer(Long peerTelegramId, String sessionId) {
        sendVerificationToTelegramPeer(peerTelegramId, VerificationEvent.mismatch(sessionId));
        LOG.debug("Sent mismatch warning to peerTelegramId={}: sessionId={}", peerTelegramId, sessionId);
    }

    /**
     * Send an error event to the requesting user.
     */
    private void sendError(TelegramPrincipal principal, String sessionId, String errorCode) {
        VerificationEvent event = VerificationEvent.error(sessionId, errorCode);

        stompUserMessenger.convertAndSendToUser(principal, VERIFICATION_DESTINATION, event);

        LOG.trace("Sent verification error: userTelegramId={}, internalId={}, code={}",
                principal.getUserId(), principal.getInternalId(), errorCode);
    }
}

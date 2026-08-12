package dev.burnedchats.handler;

import dev.burnedchats.dto.event.DmInviteMintedEvent;
import dev.burnedchats.dto.event.SessionCreatedEvent;
import dev.burnedchats.dto.request.MintDmInviteRequest;
import dev.burnedchats.dto.request.RedeemDmInviteRequest;
import dev.burnedchats.exception.PowInvalidException;
import dev.burnedchats.exception.PowRequiredException;
import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.service.DmInviteService;
import dev.burnedchats.service.SessionLifecycleService.CreateSessionResult;
import dev.burnedchats.telegram.BotMessageService;
import dev.burnedchats.telegram.BurnedChatsBot;
import dev.burnedchats.util.ParticipantContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Controller;
import org.springframework.util.StringUtils;
import org.springframework.validation.annotation.Validated;

import java.security.Principal;
import java.util.Map;

/**
 * STOMP endpoints for personal DM invite mint / redeem (IMP-DMINVITE-01).
 */
@Slf4j
@Controller
@RequiredArgsConstructor
@Validated
public class DmInviteHandler {

    private static final String ERRORS_DESTINATION = "/queue/errors";
    private static final String MINTED_DESTINATION = "/queue/dm-invite-minted";
    private static final String SESSION_CREATED_DESTINATION = "/queue/session-created";
    private static final String INCOMING_REQUEST_DESTINATION = "/queue/incoming-request";

    private final DmInviteService dmInviteService;
    private final StompUserMessenger stompUserMessenger;
    private final WebSocketExceptionHandler webSocketExceptionHandler;
    private final BurnedChatsBot telegramBot;
    private final BotMessageService botMessages;

    @MessageMapping("/dmInvite.mint")
    public void mint(@Payload MintDmInviteRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            LOG.warn("DM invite mint rejected: unsupported principal");
            return;
        }

        LOG.info("DM invite mint requested: owner={}", owner.internalId());

        dmInviteService.mint(owner, request != null ? request.getPow() : null)
                .subscribe(
                        event -> sendStompToInternalId(owner.internalId(), MINTED_DESTINATION, event),
                        error -> handleMintFailure(owner.internalId(), error));
    }

    @MessageMapping("/dmInvite.redeem")
    public void redeem(@Payload RedeemDmInviteRequest request, Principal principal) {
        ParticipantContext redeemer = ParticipantContext.from(principal);
        if (redeemer == null) {
            LOG.warn("DM invite redeem rejected: unsupported principal");
            return;
        }

        String token = request != null ? request.getToken() : null;
        LOG.info("DM invite redeem requested: redeemer={}", redeemer.internalId());

        dmInviteService.redeem(redeemer, token)
                .subscribe(
                        result -> dispatchCreateResult(redeemer, result),
                        error -> handleRedeemFailure(redeemer.internalId(), error));
    }

    private void dispatchCreateResult(ParticipantContext redeemer, CreateSessionResult result) {
        switch (result) {
            case CreateSessionResult.Created created -> {
                sendStompToInternalId(created.recipientInternalId(), INCOMING_REQUEST_DESTINATION,
                        created.recipientEvent());
                if (!created.recipientOnline()) {
                    sendTelegramNotificationIfLinked(
                            created.recipientTelegramId(),
                            created.recipientUser(),
                            created.initiatorUser(),
                            created.sessionId());
                }
                sendStompToInternalId(redeemer.internalId(), SESSION_CREATED_DESTINATION,
                        created.initiatorEvent());
            }
            case CreateSessionResult.Failed failed ->
                    sendStompToInternalId(redeemer.internalId(), SESSION_CREATED_DESTINATION,
                            failed.initiatorEvent());
        }
    }

    private void handleMintFailure(String ownerInternalId, Throwable error) {
        Throwable root = unwrap(error);
        if (root instanceof RateLimitException rateLimitException) {
            Map<String, Object> payload = webSocketExceptionHandler.handleRateLimitException(rateLimitException);
            sendStompToInternalId(ownerInternalId, ERRORS_DESTINATION, payload);
            return;
        }
        if (root instanceof PowRequiredException powRequiredException) {
            Map<String, Object> payload = webSocketExceptionHandler.handlePowRequiredException(powRequiredException);
            sendStompToInternalId(ownerInternalId, ERRORS_DESTINATION, payload);
            return;
        }
        if (root instanceof PowInvalidException powInvalidException) {
            Map<String, Object> payload = webSocketExceptionHandler.handlePowInvalidException(powInvalidException);
            sendStompToInternalId(ownerInternalId, ERRORS_DESTINATION, payload);
            return;
        }

        LOG.error("DM invite mint error: owner={}, error={}", ownerInternalId, root.getMessage());
        sendStompToInternalId(ownerInternalId, MINTED_DESTINATION,
                DmInviteMintedEvent.error("INTERNAL_ERROR"));
    }

    private void handleRedeemFailure(String redeemerInternalId, Throwable error) {
        Throwable root = unwrap(error);
        if (root instanceof RateLimitException rateLimitException) {
            Map<String, Object> payload = webSocketExceptionHandler.handleRateLimitException(rateLimitException);
            sendStompToInternalId(redeemerInternalId, ERRORS_DESTINATION, payload);
            return;
        }
        if (root instanceof IllegalArgumentException iae && iae.getMessage() != null) {
            String code = iae.getMessage();
            if (code.startsWith("DM_INVITE_") || "SELF_REDEEM".equals(code)) {
                sendStompToInternalId(redeemerInternalId, SESSION_CREATED_DESTINATION,
                        SessionCreatedEvent.error(code));
                return;
            }
        }

        LOG.error("DM invite redeem error: redeemer={}, error={}", redeemerInternalId, root.getMessage());
        sendStompToInternalId(redeemerInternalId, SESSION_CREATED_DESTINATION,
                SessionCreatedEvent.error("INTERNAL_ERROR"));
    }

    private void sendTelegramNotificationIfLinked(Long recipientTelegramId, UnifiedUser recipient,
                                                    UnifiedUser sender, String sessionId) {
        if (recipientTelegramId == null) {
            return;
        }
        botMessages.getForUser("bot.notify.chatRequest", recipientTelegramId)
                .subscribe(notificationText -> {
                    boolean sent = telegramBot.sendNotificationWithButton(
                            recipientTelegramId,
                            notificationText,
                            "dm_" + sessionId
                    );
                    if (sent) {
                        LOG.info("Telegram notification sent after DM invite redeem: sessionId={}", sessionId);
                    }
                });
    }

    private void sendStompToInternalId(String internalId, String destination, Object payload) {
        if (!StringUtils.hasText(internalId)) {
            return;
        }
        stompUserMessenger.convertAndSendToInternalId(internalId, destination, payload);
    }

    private static Throwable unwrap(Throwable error) {
        Throwable root = error;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        return root;
    }
}

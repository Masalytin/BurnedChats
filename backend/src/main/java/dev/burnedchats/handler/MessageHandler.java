package dev.burnedchats.handler;

import dev.burnedchats.dto.event.MessageSentEvent;
import dev.burnedchats.dto.event.NewMessageEvent;
import dev.burnedchats.dto.event.SyncMessagesEvent;
import dev.burnedchats.dto.request.SendMessageRequest;
import dev.burnedchats.dto.request.SyncMessagesRequest;
import dev.burnedchats.model.Message;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.repository.MessageRepository;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.service.FileMessageRelayValidator;
import dev.burnedchats.service.FileMessageRelayValidator.FileValidationException;
import dev.burnedchats.telegram.BurnedChatsBot;
import dev.burnedchats.telegram.BotMessageService;
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
import java.util.List;

/**
 * STOMP handler for encrypted message relay.
 *
 * <p>Handles message exchange between chat participants. The server acts
 * purely as a relay - it never decrypts or stores message content permanently.
 * Messages are only temporarily queued if the recipient is offline.
 *
 * <p>Message flow:
 * <ol>
 *   <li>Sender encrypts message client-side with shared AES key</li>
 *   <li>Sender sends encrypted message via {@code /app/message.send}</li>
 *   <li>Server validates session and participant</li>
 *   <li>If recipient online: relay immediately via NEW_MESSAGE event</li>
 *   <li>If recipient offline: queue message and send Telegram notification</li>
 *   <li>Send acknowledgment to sender via MESSAGE_SENT event</li>
 * </ol>
 *
 * <p>Destinations:
 * <ul>
 *   <li>{@code /app/message.send} - send encrypted message</li>
 * </ul>
 *
 * <p>Events sent:
 * <ul>
 *   <li>{@code /user/queue/new-message} - new message for recipient</li>
 *   <li>{@code /user/queue/message-sent} - acknowledgment for sender</li>
 * </ul>
 *
 * <p>Security notes:
 * <ul>
 *   <li>Messages are encrypted end-to-end with AES-256-GCM</li>
 *   <li>Server only validates session membership, not content</li>
 *   <li>Offline messages are stored encrypted, auto-expire in 1 hour</li>
 *   <li>Messages are deleted immediately after delivery</li>
 * </ul>
 *
 * @see SendMessageRequest
 * @see NewMessageEvent
 * @see MessageSentEvent
 */
@Slf4j
@Controller
@RequiredArgsConstructor
@Validated
public class MessageHandler {

    /**
     * STOMP destination for new message events (sent to recipient).
     */
    private static final String NEW_MESSAGE_DESTINATION = "/queue/new-message";

    /**
     * STOMP destination for message sent acknowledgment (sent to sender).
     */
    private static final String MESSAGE_SENT_DESTINATION = "/queue/message-sent";

    /**
     * STOMP destination for synced messages (sent to requester).
     */
    private static final String SYNC_MESSAGES_DESTINATION = "/queue/sync-messages";


    private final SessionRepository sessionRepository;
    private final MessageRepository messageRepository;
    private final OnlineStatusRepository onlineStatusRepository;
    private final SimpMessagingTemplate messagingTemplate;
    private final BurnedChatsBot telegramBot;
    private final BotMessageService botMessages;
    private final FileMessageRelayValidator fileMessageRelayValidator;

    /**
     * Relay an encrypted message to the peer.
     *
     * <p>This method receives an encrypted message from a sender and either:
     * <ul>
     *   <li>Relays it immediately if the recipient is online</li>
     *   <li>Queues it for later delivery if the recipient is offline</li>
     * </ul>
     *
     * <p>In both cases, a Telegram notification is sent to the recipient
     * if they are offline to alert them of the new message.
     *
     * @param request   the send message request containing encrypted content
     * @param principal authenticated user principal
     */
    @MessageMapping("/message.send")
    public void relayMessage(@Payload SendMessageRequest request, Principal principal) {
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long senderId = telegramPrincipal.getUserId();
        String sessionId = request.getSessionId();
        String messageId = request.getMessageId();

        log.info("Message relay requested: sessionId={}, senderId={}, messageId={}",
                sessionId, senderId, messageId);

        // Validate session and relay message
        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    log.debug("Session not found for message: {}", sessionId);
                    sendError(senderId, sessionId, messageId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> validateAndRelayMessage(session, senderId, request))
                .subscribe(
                        result -> {},
                        error -> {
                            log.error("Error relaying message: sessionId={}, senderId={}, error={}",
                                    sessionId, senderId, error.getMessage());
                            sendError(senderId, sessionId, messageId, "INTERNAL_ERROR");
                        }
                );
    }

    /**
     * Sync pending messages after reconnection (5.1.2).
     *
     * <p>Called when a client reconnects and needs to retrieve messages
     * that were queued while offline. Returns all pending messages for
     * the specified session.
     *
     * @param request   the sync request containing session ID
     * @param principal authenticated user principal
     */
    @MessageMapping("/message.sync")
    public void syncMessages(@Payload SyncMessagesRequest request, Principal principal) {
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long userId = telegramPrincipal.getUserId();
        String sessionId = request.sessionId();

        log.info("Sync messages requested: sessionId={}, userId={}", sessionId, userId);

        // Validate session and sync messages
        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    log.debug("Session not found for sync: {}", sessionId);
                    sendSyncError(userId, sessionId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> {
                    // Validate user is participant
                    if (!session.isParticipant(userId)) {
                        log.debug("User {} is not a participant in session {}", userId, sessionId);
                        sendSyncError(userId, sessionId, "NOT_PARTICIPANT");
                        return Mono.empty();
                    }

                    // Get pending messages
                    return messageRepository.getPendingMessages(userId, sessionId)
                            .collectList()
                            .flatMap(messages -> {
                                List<SyncMessagesEvent.SyncedMessage> syncedMessages = messages.stream()
                                        .map(SyncMessagesEvent.SyncedMessage::fromMessage)
                                        .toList();

                                // Send sync event to user
                                SyncMessagesEvent event = SyncMessagesEvent.success(sessionId, syncedMessages);
                                messagingTemplate.convertAndSendToUser(
                                        String.valueOf(userId),
                                        SYNC_MESSAGES_DESTINATION,
                                        event
                                );

                                log.info("Synced {} messages for user {} in session {}",
                                        syncedMessages.size(), userId, sessionId);

                                // Delete delivered messages from queue
                                if (!messages.isEmpty()) {
                                    return messageRepository.deleteMessages(userId, sessionId)
                                            .then(Mono.empty());
                                }
                                return Mono.empty();
                            });
                })
                .subscribe(
                        result -> {},
                        error -> {
                            log.error("Error syncing messages: sessionId={}, userId={}, error={}",
                                    sessionId, userId, error.getMessage());
                            sendSyncError(userId, sessionId, "INTERNAL_ERROR");
                        }
                );
    }

    /**
     * Send sync error event to user.
     */
    private void sendSyncError(Long userId, String sessionId, String errorCode) {
        SyncMessagesEvent event = SyncMessagesEvent.error(sessionId, errorCode);
        messagingTemplate.convertAndSendToUser(
                String.valueOf(userId),
                SYNC_MESSAGES_DESTINATION,
                event
        );
    }

    /**
     * Validate session state and relay/queue the message.
     */
    private Mono<Void> validateAndRelayMessage(Session session, Long senderId,
                                                SendMessageRequest request) {
        String sessionId = session.getId();
        String messageId = request.getMessageId();

        // Validate sender is a participant
        if (!session.isParticipant(senderId)) {
            log.debug("User {} is not a participant in session {}", senderId, sessionId);
            sendError(senderId, sessionId, messageId, "NOT_PARTICIPANT");
            return Mono.empty();
        }

        // Validate session status - must be ACTIVE
        SessionStatus status = session.getStatus();
        if (status != SessionStatus.ACTIVE) {
            log.debug("Session {} is not active, status: {}", sessionId, status);
            String errorCode = switch (status) {
                case PENDING -> "SESSION_PENDING";
                case HANDSHAKE -> "SESSION_HANDSHAKE";
                case BURNED -> "SESSION_BURNED";
                case EXPIRED -> "SESSION_EXPIRED";
                default -> "INVALID_STATUS";
            };
            sendError(senderId, sessionId, messageId, errorCode);
            return Mono.empty();
        }

        // Get recipient ID
        Long recipientId = session.getPeerId(senderId);
        if (recipientId == null) {
            log.error("Could not determine recipient for sender {} in session {}", senderId, sessionId);
            sendError(senderId, sessionId, messageId, "INTERNAL_ERROR");
            return Mono.empty();
        }

        // File validation for non-text messages
        Mono<Void> fileValidation = Mono.empty();
        if (FileMessageRelayValidator.isFileMessage(request.getType())) {
            fileValidation = fileMessageRelayValidator.validateFileMessage(
                    request.getFileId(), request.getThumbnailFileId(), senderId, sessionId);
        }

        // Update session last activity
        session.touch();

        return fileValidation
                .then(sessionRepository.save(session))
                .then(onlineStatusRepository.isOnline(recipientId))
                .flatMap(isRecipientOnline -> {
                    Instant serverTimestamp = Instant.now();

                    if (isRecipientOnline) {
                        return deliverMessageImmediately(session, senderId, recipientId, request, serverTimestamp);
                    } else {
                        return queueMessageForOfflineDelivery(session, senderId, recipientId, request, serverTimestamp);
                    }
                })
                .onErrorResume(FileValidationException.class, ex -> {
                    log.debug("File validation failed for message {} in session {}: {}",
                            messageId, sessionId, ex.getErrorCode());
                    sendError(senderId, sessionId, messageId, ex.getErrorCode());
                    return Mono.empty();
                });
    }

    /**
     * Deliver message immediately to online recipient.
     */
    private Mono<Void> deliverMessageImmediately(Session session, Long senderId, Long recipientId,
                                                   SendMessageRequest request, Instant serverTimestamp) {
        String sessionId = session.getId();
        String messageId = request.getMessageId();
        String type = request.getType() != null ? request.getType() : "text";

        // Build NEW_MESSAGE event with file fields when applicable
        NewMessageEvent.NewMessageEventBuilder eventBuilder = NewMessageEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .messageId(messageId)
                .senderId(senderId)
                .encryptedContent(request.getEncryptedContent())
                .iv(request.getIv())
                .clientTimestamp(request.getTimestamp())
                .serverTimestamp(serverTimestamp)
                .type(type);

        if (FileMessageRelayValidator.isFileMessage(type)) {
            eventBuilder
                    .fileId(request.getFileId())
                    .thumbnailFileId(request.getThumbnailFileId())
                    .encryptedMeta(request.getEncryptedMeta())
                    .fileSize(request.getFileSize());
        }

        messagingTemplate.convertAndSendToUser(
                String.valueOf(recipientId),
                NEW_MESSAGE_DESTINATION,
                eventBuilder.build()
        );

        // Send acknowledgment to sender
        MessageSentEvent sentEvent = MessageSentEvent.delivered(sessionId, messageId, serverTimestamp);
        messagingTemplate.convertAndSendToUser(
                String.valueOf(senderId),
                MESSAGE_SENT_DESTINATION,
                sentEvent
        );

        log.info("Message delivered immediately: sessionId={}, messageId={}, type={}, from={}, to={}",
                sessionId, messageId, type, senderId, recipientId);

        return Mono.empty();
    }

    /**
     * Queue message for offline delivery and send Telegram notification.
     */
    private Mono<Void> queueMessageForOfflineDelivery(Session session, Long senderId, Long recipientId,
                                                        SendMessageRequest request, Instant serverTimestamp) {
        String sessionId = session.getId();
        String messageId = request.getMessageId();

        // Create message for queue — use file-aware factory for non-text types
        Message message;
        if (FileMessageRelayValidator.isFileMessage(request.getType())) {
            message = Message.fromFileRequest(
                    sessionId, senderId, recipientId, messageId,
                    request.getEncryptedContent(), request.getIv(), request.getTimestamp(),
                    request.getType(), request.getFileId(), request.getThumbnailFileId(),
                    request.getEncryptedMeta(), request.getFileSize());
        } else {
            message = Message.fromRequest(
                    sessionId, senderId, recipientId, messageId,
                    request.getEncryptedContent(), request.getIv(), request.getTimestamp());
        }

        return messageRepository.queueMessage(message)
                .flatMap(queued -> {
                    if (!queued) {
                        log.warn("Failed to queue message: sessionId={}, messageId={}", sessionId, messageId);
                        sendError(senderId, sessionId, messageId, "QUEUE_FAILED");
                        return Mono.empty();
                    }

                    // Send Telegram notification to offline recipient
                    sendOfflineNotification(senderId, recipientId, sessionId);

                    // Send acknowledgment to sender
                    MessageSentEvent sentEvent = MessageSentEvent.queued(sessionId, messageId, serverTimestamp);
                    messagingTemplate.convertAndSendToUser(
                            String.valueOf(senderId),
                            MESSAGE_SENT_DESTINATION,
                            sentEvent
                    );

                    log.info("Message queued for offline delivery: sessionId={}, messageId={}, from={}, to={}",
                            sessionId, messageId, senderId, recipientId);

                    return Mono.empty();
                });
    }

    /**
     * Send Telegram notification to offline recipient about new message.
     *
     * <p>The notification includes:
     * <ul>
     *   <li>Information about who sent the message</li>
     *   <li>Button to open Mini App and read messages</li>
     * </ul>
     *
     * @param senderId    Telegram user ID of sender
     * @param recipientId Telegram user ID of recipient
     * @param sessionId   the session ID for deep linking
     */
    private void sendOfflineNotification(Long senderId, Long recipientId, String sessionId) {
        botMessages.getForUser("bot.notify.newMessage", recipientId)
                .subscribe(notificationText -> {
                    boolean sent = telegramBot.sendNotificationWithButton(
                            recipientId,
                            notificationText,
                            sessionId
                    );

                    if (sent) {
                        log.info("Telegram notification sent to offline recipient {}: sessionId={}",
                                recipientId, sessionId);
                    } else {
                        log.warn("Failed to send Telegram notification to recipient {}", recipientId);
                    }
                });
    }

    /**
     * Send error event to the sender.
     */
    private void sendError(Long senderId, String sessionId, String messageId, String errorCode) {
        MessageSentEvent event = MessageSentEvent.error(sessionId, messageId, errorCode);

        messagingTemplate.convertAndSendToUser(
                String.valueOf(senderId),
                MESSAGE_SENT_DESTINATION,
                event
        );

        log.trace("Sent message error to sender {}: {}", senderId, errorCode);
    }
}

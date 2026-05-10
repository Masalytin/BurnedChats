package dev.burnedchats.handler;

import dev.burnedchats.dto.event.MessageDeletedEvent;
import dev.burnedchats.dto.event.MessageEditedEvent;
import dev.burnedchats.dto.event.MessageSentEvent;
import dev.burnedchats.dto.event.NewMessageEvent;
import dev.burnedchats.dto.event.SyncMessagesEvent;
import dev.burnedchats.dto.request.DeleteMessageRequest;
import dev.burnedchats.dto.request.EditMessageRequest;
import dev.burnedchats.dto.request.SendMessageRequest;
import dev.burnedchats.dto.request.SyncMessagesRequest;
import dev.burnedchats.model.DmMessageEditableMeta;
import dev.burnedchats.model.Message;
import dev.burnedchats.model.MessageDeletion;
import dev.burnedchats.model.MessageEdit;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.metrics.OfflineQueueMetrics;
import dev.burnedchats.metrics.OfflineSessionType;
import dev.burnedchats.repository.MessageRepository;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.service.FileBurnService;
import dev.burnedchats.service.FileMessageRelayValidator;
import dev.burnedchats.service.FileMessageRelayValidator.FileValidationException;
import dev.burnedchats.telegram.BurnedChatsBot;
import dev.burnedchats.telegram.BotMessageService;
import jakarta.validation.Valid;
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
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

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
 *   <li>Offline messages are stored encrypted, TTL from {@code burnedchats.messages.offline-queue}</li>
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

    private static final String MESSAGE_EDITED_DESTINATION = "/queue/message-edited";

    private static final String MESSAGE_DELETED_DESTINATION = "/queue/message-deleted";

    private final SessionRepository sessionRepository;
    private final MessageRepository messageRepository;
    private final OnlineStatusRepository onlineStatusRepository;
    private final UserIdentityRepository userIdentityRepository;
    private final StompUserMessenger stompUserMessenger;
    private final BurnedChatsBot telegramBot;
    private final BotMessageService botMessages;
    private final FileMessageRelayValidator fileMessageRelayValidator;
    private final FileBurnService fileBurnService;
    private final OfflineQueueMetrics offlineQueueMetrics;

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
    @MessageMapping("/message.edit")
    public void editMessage(@Payload @Valid EditMessageRequest request, Principal principal) {
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long senderId = telegramPrincipal.getUserId();
        String sessionId = request.getSessionId();
        String messageId = request.getMessageId();
        LOG.info("DM message edit: sessionId={}, messageId={}, senderTelegramId={}, internalId={}",
                sessionId, messageId, senderId, telegramPrincipal.getInternalId());

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    sendMessageEditError(telegramPrincipal, sessionId, messageId, "NOT_EDITABLE");
                    return Mono.empty();
                }))
                .flatMap(session -> applyDmEdit(session, telegramPrincipal, request))
                .subscribe(
                        v -> { },
                        error -> {
                            LOG.error("editMessage: sessionId={}, error={}", sessionId, error.getMessage());
                            sendMessageEditError(telegramPrincipal, sessionId, messageId, "INTERNAL_ERROR");
                        }
            );
    }

    @MessageMapping("/message.send")
    public void relayMessage(@Payload SendMessageRequest request, Principal principal) {
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long senderId = telegramPrincipal.getUserId();
        String sessionId = request.getSessionId();
        String messageId = request.getMessageId();

        LOG.info("Message relay requested: sessionId={}, senderId={}, messageId={}",
                sessionId, senderId, messageId);

        // Validate session and relay message
        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Session not found for message: {}", sessionId);
                    sendError(telegramPrincipal, sessionId, messageId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> validateAndRelayMessage(session, telegramPrincipal, request))
                .subscribe(
                        result -> {},
                        error -> {
                            LOG.error("Error relaying message: sessionId={}, senderTelegramId={}, error={}",
                                    sessionId, senderId, error.getMessage());
                            sendError(telegramPrincipal, sessionId, messageId, "INTERNAL_ERROR");
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
    @SuppressWarnings("checkstyle:MethodLength")
    @MessageMapping("/message.sync")
    public void syncMessages(@Payload SyncMessagesRequest request, Principal principal) {
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long userId = telegramPrincipal.getUserId();
        String internalId = telegramPrincipal.getInternalId();
        String sessionId = request.sessionId();

        LOG.info("Sync messages requested: sessionId={}, telegramId={}, internalId={}",
                sessionId, userId, internalId);

        // Validate session and sync messages
        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Session not found for sync: {}", sessionId);
                    sendSyncError(telegramPrincipal, sessionId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> {
                    // Validate user is participant
                    if (!session.isParticipant(userId)) {
                        LOG.debug("User {} is not a participant in session {}", userId, sessionId);
                        sendSyncError(telegramPrincipal, sessionId, "NOT_PARTICIPANT");
                        return Mono.empty();
                    }

                    // Pending messages, tombstone edits, and tombstone deletions
                    return Mono.zip(
                            messageRepository.getPendingMessages(internalId, sessionId).collectList(),
                            messageRepository.getPendingEdits(internalId, sessionId).collectList(),
                            messageRepository.getPendingDeletions(internalId, sessionId).collectList()
                    ).flatMap(tuple -> {
                        List<Message> messages = tuple.getT1();
                        List<MessageEdit> pendingEdits = tuple.getT2();
                        List<MessageDeletion> deletions = tuple.getT3();
                        Set<String> deletedIdSet = deletions.stream()
                                .map(MessageDeletion::getMessageId)
                                .collect(Collectors.toSet());
                        List<SyncMessagesEvent.SyncedEdit> syncedEdits = pendingEdits.stream()
                                .filter(e -> !deletedIdSet.contains(e.getMessageId()))
                                .map(SyncMessagesEvent.SyncedEdit::fromMessageEdit)
                                .toList();
                        List<String> deletedIds = deletions.stream()
                                .map(MessageDeletion::getMessageId)
                                .toList();
                        List<SyncMessagesEvent.SyncedMessage> syncedMessages = messages.stream()
                                .map(SyncMessagesEvent.SyncedMessage::fromMessage)
                                .toList();

                        if (syncedMessages.isEmpty() && syncedEdits.isEmpty() && deletedIds.isEmpty()) {
                            return Mono.empty();
                        }

                        SyncMessagesEvent event = SyncMessagesEvent.success(
                                sessionId, syncedMessages, deletedIds, syncedEdits);
                        stompUserMessenger.convertAndSendToUser(
                                telegramPrincipal,
                                SYNC_MESSAGES_DESTINATION,
                                event
                        );

                        LOG.info(
                                "Synced {} messages, {} edits, {} deletions for telegramId={}, "
                                        + "internalId={} in session {}",
                                syncedMessages.size(), syncedEdits.size(), deletedIds.size(), userId, internalId,
                                sessionId);

                        Mono<Void> after = Mono.empty();
                        if (!messages.isEmpty()) {
                            offlineQueueMetrics.recordDelivered(OfflineSessionType.dm, messages.size());
                            after = after.then(messageRepository.deleteMessages(internalId, sessionId).then());
                        }
                        if (!pendingEdits.isEmpty()) {
                            offlineQueueMetrics.recordDelivered(OfflineSessionType.dm_edit, pendingEdits.size());
                            after = after.then(messageRepository.deleteEdits(internalId, sessionId).then());
                        }
                        if (!deletions.isEmpty()) {
                            offlineQueueMetrics.recordDelivered(OfflineSessionType.dm_deletion, deletions.size());
                            after = after.then(messageRepository.deleteDeletions(internalId, sessionId).then());
                        }
                        return after;
                    });
                })
                .subscribe(
                        result -> {},
                        error -> {
                            LOG.error("Error syncing messages: sessionId={}, telegramId={}, internalId={}, error={}",
                                    sessionId, userId, internalId, error.getMessage());
                            sendSyncError(telegramPrincipal, sessionId, "INTERNAL_ERROR");
                        }
            );
    }

    /**
     * Send sync error event to user.
     */
    private void sendSyncError(TelegramPrincipal recipient, String sessionId, String errorCode) {
        SyncMessagesEvent event = SyncMessagesEvent.error(sessionId, errorCode);
        stompUserMessenger.convertAndSendToUser(recipient, SYNC_MESSAGES_DESTINATION, event);
    }

    @MessageMapping("/message.delete")
    public void deleteMessage(@Payload @Valid DeleteMessageRequest request, Principal principal) {
        TelegramPrincipal tp = (TelegramPrincipal) principal;
        Long deleterId = tp.getUserId();
        String sessionId = request.getSessionId();
        String messageId = request.getMessageId();
        LOG.info("DM message delete: sessionId={}, messageId={}, deleterTelegramId={}, internalId={}",
                sessionId, messageId, deleterId, tp.getInternalId());

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    sendMessageDeletedError(tp, sessionId, messageId, "NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> runDmDelete(session, tp, deleterId, messageId))
                .subscribe(
                        v -> { },
                        error -> {
                            LOG.error("deleteMessage: sessionId={}, error={}", sessionId, error.getMessage());
                            sendMessageDeletedError(tp, sessionId, messageId, "INTERNAL_ERROR");
                        }
            );
    }

    private Mono<Void> runDmDelete(Session session, TelegramPrincipal deleterPrincipal, Long deleterId,
            String messageId) {
        String sessionId = session.getId();
        if (!session.isParticipant(deleterId)) {
            sendMessageDeletedError(deleterPrincipal, sessionId, messageId, "NOT_PARTICIPANT");
            return Mono.empty();
        }
        if (session.getStatus() != SessionStatus.ACTIVE) {
            String err = errorCodeForNonActiveMessageSession(session.getStatus());
            sendMessageDeletedError(deleterPrincipal, sessionId, messageId, err);
            return Mono.empty();
        }
        Long peerId = session.getPeerId(deleterId);
        if (peerId == null) {
            sendMessageDeletedError(deleterPrincipal, sessionId, messageId, "INTERNAL_ERROR");
            return Mono.empty();
        }
        return messageRepository.removeMessageFromQueue(peerId, sessionId, messageId)
                .flatMap(removed -> {
                    if (removed.isPresent()) {
                        if (!deleterId.equals(removed.get().getSenderId())) {
                            sendMessageDeletedError(deleterPrincipal, sessionId, messageId, "NOT_ALLOWED");
                            return Mono.empty();
                        }
                        return finalizeDmDeleteFromQueue(
                                session, deleterPrincipal, peerId, deleterId, messageId, removed.get());
                    }
                    return assertDeleterOwnsMessage(sessionId, messageId, deleterId)
                            .flatMap(code -> {
                                if (!"OK".equals(code)) {
                                    sendMessageDeletedError(deleterPrincipal, sessionId, messageId, code);
                                    return Mono.empty();
                                }
                                return messageRepository.getDmMessageEditableMeta(sessionId, messageId)
                                        .switchIfEmpty(Mono.just(DmMessageEditableMeta.builder().build()))
                                        .flatMap(meta -> finalizeDmDeleteDelivered(
                                                session, deleterPrincipal, peerId, deleterId, messageId, meta));
                            });
                });
    }

    private Mono<String> assertDeleterOwnsMessage(String sessionId, String messageId, Long deleterId) {
        return messageRepository.getMessageSenderIndex(sessionId, messageId)
                .map(sid -> deleterId.equals(sid) ? "OK" : "NOT_ALLOWED")
                .switchIfEmpty(
                        messageRepository.getDmMessageEditableMeta(sessionId, messageId)
                                .map(m -> deleterId.equals(m.getSenderId()) ? "OK" : "NOT_ALLOWED")
                                .switchIfEmpty(Mono.just("NOT_FOUND"))
                );
    }

    private Mono<Void> finalizeDmDeleteFromQueue(
            Session session, TelegramPrincipal deleterPrincipal, Long peerId, Long deleterId, String messageId,
            Message fromQueue) {
        String sessionId = session.getId();
        if (FileMessageRelayValidator.isFileMessage(fromQueue.getType())) {
            fileBurnService.burnFiles(fromQueue.getFileId(), fromQueue.getThumbnailFileId());
        }
        return messageRepository.removeMessageSenderIndex(sessionId, messageId)
                .then(messageRepository.deleteDmMessageEditableMeta(sessionId, messageId))
                .then(broadcastDmDeleted(session, deleterPrincipal, peerId, deleterId, messageId));
    }

    private Mono<Void> finalizeDmDeleteDelivered(
            Session session, TelegramPrincipal deleterPrincipal, Long peerId, Long deleterId, String messageId,
            DmMessageEditableMeta meta) {
        String sessionId = session.getId();
        if (meta != null && meta.getFileId() != null) {
            fileBurnService.burnFiles(meta.getFileId(), meta.getThumbnailFileId());
        }
        return messageRepository.removeMessageSenderIndex(sessionId, messageId)
                .then(messageRepository.deleteDmMessageEditableMeta(sessionId, messageId))
                .then(broadcastDmDeleted(session, deleterPrincipal, peerId, deleterId, messageId));
    }

    private Mono<Void> broadcastDmDeleted(
            Session session, TelegramPrincipal deleterPrincipal, Long peerId, Long deleterId, String messageId) {
        String sessionId = session.getId();
        Instant deletedAt = Instant.now();
        MessageDeletedEvent ev = MessageDeletedEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .messageId(messageId)
                .deletedByTgId(deleterId)
                .deletedByOwner(false)
                .deletedAt(deletedAt)
                .build();
        sendDmMessageDeletedEvent(deleterPrincipal, deleterId, ev);
        MessageDeletion tomb = MessageDeletion.builder()
                .messageId(messageId)
                .deletedByTgId(deleterId)
                .deletedAt(deletedAt)
                .build();
        return onlineStatusRepository.isOnline(peerId)
                .flatMap(online -> {
                    if (Boolean.TRUE.equals(online)) {
                        return userIdentityRepository.findByTelegramId(peerId)
                                .filter(StringUtils::hasText)
                                .doOnNext(recipientInternalId -> {
                                    LOG.debug("DM delete STOMP: peerTelegramId={}, peerInternalId={}, sessionId={}",
                                            peerId, recipientInternalId, sessionId);
                                    stompUserMessenger.convertAndSendToInternalId(
                                            recipientInternalId, MESSAGE_DELETED_DESTINATION, ev);
                                })
                                .hasElement()
                                .flatMap(sent -> {
                                    if (Boolean.TRUE.equals(sent)) {
                                        return Mono.<Void>empty();
                                    }
                                    LOG.debug(
                                            "DM delete: peerTelegramId={} has no "
                                                    + "UserIdentity mapping; tombstone queued",
                                            peerId);
                                    return messageRepository.queueDeletion(peerId, sessionId, tomb).then();
                                });
                    }
                    return messageRepository.queueDeletion(peerId, sessionId, tomb)
                            .then(Mono.empty());
                });
    }

    private void sendDmMessageDeletedEvent(TelegramPrincipal deleterPrincipal, Long deleterTelegramId,
            MessageDeletedEvent event) {
        stompUserMessenger.convertAndSendToUser(deleterPrincipal, MESSAGE_DELETED_DESTINATION, event);
        LOG.trace("DM delete STOMP to deleter telegramId={}, internalId={}",
                deleterTelegramId, deleterPrincipal.getInternalId());
    }

    private void sendMessageDeletedError(TelegramPrincipal recipient, String sessionId, String messageId,
            String errorCode) {
        MessageDeletedEvent event = MessageDeletedEvent.builder()
                .success(false)
                .sessionId(sessionId)
                .messageId(messageId)
                .errorCode(errorCode)
                .build();
        stompUserMessenger.convertAndSendToUser(recipient, MESSAGE_DELETED_DESTINATION, event);
    }

    /**
     * Validate session state and relay/queue the message.
     */
    @SuppressWarnings("checkstyle:MethodLength")
    private Mono<Void> validateAndRelayMessage(Session session, TelegramPrincipal senderPrincipal,
                                               SendMessageRequest request) {
        Long senderId = senderPrincipal.getUserId();
        String sessionId = session.getId();
        String messageId = request.getMessageId();

        // Validate sender is a participant
        if (!session.isParticipant(senderId)) {
            LOG.debug("User {} is not a participant in session {}", senderId, sessionId);
            sendError(senderPrincipal, sessionId, messageId, "NOT_PARTICIPANT");
            return Mono.empty();
        }

        // Validate session status - must be ACTIVE
        SessionStatus status = session.getStatus();
        if (status != SessionStatus.ACTIVE) {
            LOG.debug("Session {} is not active, status: {}", sessionId, status);
            sendError(senderPrincipal, sessionId, messageId, errorCodeForNonActiveMessageSession(status));
            return Mono.empty();
        }

        // Get recipient ID
        Long recipientId = session.getPeerId(senderId);
        if (recipientId == null) {
            LOG.error("Could not determine recipient for sender {} in session {}", senderId, sessionId);
            sendError(senderPrincipal, sessionId, messageId, "INTERNAL_ERROR");
            return Mono.empty();
        }

        logReplyToIfPresent(request, sessionId);

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
                        return deliverMessageImmediately(
                                session, senderPrincipal, senderId, recipientId, request, serverTimestamp);
                    } else {
                        return queueMessageForOfflineDelivery(
                                session, senderPrincipal, senderId, recipientId, request, serverTimestamp);
                    }
                })
                .onErrorResume(FileValidationException.class, ex -> {
                    LOG.debug("File validation failed for message {} in session {}: {}",
                            messageId, sessionId, ex.getErrorCode());
                    sendError(senderPrincipal, sessionId, messageId, ex.getErrorCode());
                    return Mono.empty();
                });
    }

    /**
     * Deliver message immediately to online recipient.
     */
    @SuppressWarnings("checkstyle:MethodLength")
    private Mono<Void> deliverMessageImmediately(Session session, TelegramPrincipal senderPrincipal,
                                                   Long senderId, Long recipientId,
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
        if (request.getReplyToMessageId() != null && !request.getReplyToMessageId().isBlank()) {
            eventBuilder.replyToMessageId(request.getReplyToMessageId());
        }

        NewMessageEvent newMessageEvent = eventBuilder.build();
        MessageSentEvent sentEvent = MessageSentEvent.delivered(sessionId, messageId, serverTimestamp);

        return userIdentityRepository.findByTelegramId(recipientId)
                .filter(StringUtils::hasText)
                .flatMap(recipientInternalId -> {
                    stompUserMessenger.convertAndSendToInternalId(
                            recipientInternalId, NEW_MESSAGE_DESTINATION, newMessageEvent);
                    stompUserMessenger.convertAndSendToUser(senderPrincipal, MESSAGE_SENT_DESTINATION, sentEvent);

                    LOG.info(
                            "Message delivered immediately: sessionId={}, messageId={}, type={}, "
                                    + "senderTelegramId={}, recipientTelegramId={}, recipientInternalId={}",
                            sessionId, messageId, type, senderId, recipientId, recipientInternalId);

                    String fileId = FileMessageRelayValidator.isFileMessage(type) ? request.getFileId() : null;
                    String thumbId = FileMessageRelayValidator.isFileMessage(type)
                            ? request.getThumbnailFileId()
                            : null;
                    return messageRepository.putDmMessageEditableMeta(
                                    sessionId, messageId, senderId, serverTimestamp, fileId, thumbId)
                            .then(messageRepository.putMessageSenderIndex(sessionId, messageId, senderId))
                            .then();
                })
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug(
                            "Online recipient telegramId={} has no UserIdentity mapping; falling back "
                                    + "to offline queue sessionId={}, messageId={}",
                            recipientId, sessionId, messageId);
                    return queueMessageForOfflineDelivery(
                            session, senderPrincipal, senderId, recipientId, request, serverTimestamp);
                }));
    }

    /**
     * Queue message for offline delivery and send Telegram notification.
     */
    private Mono<Void> queueMessageForOfflineDelivery(Session session, TelegramPrincipal senderPrincipal,
                                                        Long senderId, Long recipientId,
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
                    request.getEncryptedMeta(), request.getFileSize(), request.getReplyToMessageId());
        } else {
            message = Message.fromRequest(
                    sessionId, senderId, recipientId, messageId,
                    request.getEncryptedContent(), request.getIv(), request.getTimestamp(),
                    request.getReplyToMessageId());
        }

        return messageRepository.queueMessage(message)
                .flatMap(queued -> {
                    if (!queued) {
                        LOG.warn("Failed to queue message: sessionId={}, messageId={}", sessionId, messageId);
                        sendError(senderPrincipal, sessionId, messageId, "QUEUE_FAILED");
                        return Mono.<Void>empty();
                    }

                    // Send Telegram notification to offline recipient
                    sendOfflineNotification(senderId, recipientId, sessionId);

                    // Send acknowledgment to sender
                    MessageSentEvent sentEvent = MessageSentEvent.queued(sessionId, messageId, serverTimestamp);
                    stompUserMessenger.convertAndSendToUser(senderPrincipal, MESSAGE_SENT_DESTINATION, sentEvent);

                    LOG.info(
                            "Message queued for offline delivery: sessionId={}, messageId={}, "
                                    + "senderTelegramId={}, recipientTelegramId={}, senderInternalId={}",
                            sessionId, messageId, senderId, recipientId, senderPrincipal.getInternalId());

                    String queuedType = request.getType() != null ? request.getType() : "text";
                    String fileId = FileMessageRelayValidator.isFileMessage(queuedType) ? request.getFileId() : null;
                    String thumbId = FileMessageRelayValidator.isFileMessage(queuedType)
                            ? request.getThumbnailFileId()
                            : null;
                    return messageRepository
                            .putDmMessageEditableMeta(sessionId, messageId, senderId, serverTimestamp, fileId, thumbId)
                            .then(messageRepository.putMessageSenderIndex(sessionId, messageId, senderId))
                            .then();
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
                        LOG.info("Telegram notification sent to offline recipient {}: sessionId={}",
                                recipientId, sessionId);
                    } else {
                        LOG.warn("Failed to send Telegram notification to recipient {}", recipientId);
                    }
                });
    }

    private static String errorCodeForNonActiveMessageSession(SessionStatus status) {
        return switch (status) {
            case PENDING -> "SESSION_PENDING";
            case HANDSHAKE -> "SESSION_HANDSHAKE";
            case BURNED -> "SESSION_BURNED";
            case EXPIRED -> "SESSION_EXPIRED";
            default -> "INVALID_STATUS";
        };
    }

    /**
     * Send error event to the sender.
     */
    private void sendError(TelegramPrincipal sender, String sessionId, String messageId, String errorCode) {
        MessageSentEvent event = MessageSentEvent.error(sessionId, messageId, errorCode);
        stompUserMessenger.convertAndSendToUser(sender, MESSAGE_SENT_DESTINATION, event);
        LOG.trace("Sent message error to sender telegramId={}, internalId={}, code={}",
                sender.getUserId(), sender.getInternalId(), errorCode);
    }

    private void logReplyToIfPresent(SendMessageRequest request, String sessionId) {
        String replyTo = request.getReplyToMessageId();
        if (replyTo != null && !replyTo.isBlank()) {
            LOG.debug("message.send includes replyToMessageId={} sessionId={}", replyTo, sessionId);
        }
    }

    @SuppressWarnings("checkstyle:MethodLength")
    private Mono<Void> applyDmEdit(Session session, TelegramPrincipal editorPrincipal, EditMessageRequest req) {
        Long senderId = editorPrincipal.getUserId();
        String sessionId = session.getId();
        String messageId = req.getMessageId();
        if (!session.isParticipant(senderId)) {
            sendMessageEditError(editorPrincipal, sessionId, messageId, "NOT_PARTICIPANT");
            return Mono.empty();
        }
        if (session.getStatus() != SessionStatus.ACTIVE) {
            String err = errorCodeForNonActiveMessageSession(session.getStatus());
            sendMessageEditError(editorPrincipal, sessionId, messageId, err);
            return Mono.empty();
        }
        Long recipientId = session.getPeerId(senderId);
        if (recipientId == null) {
            sendMessageEditError(editorPrincipal, sessionId, messageId, "INTERNAL_ERROR");
            return Mono.empty();
        }
        Instant editedAt = Instant.ofEpochMilli(req.getEditedAt());
        if (isClientEditTimeImplausible(req.getOriginalClientTimestamp(), req.getEditedAt())) {
            sendMessageEditError(editorPrincipal, sessionId, messageId, "WINDOW_EXPIRED");
            return Mono.empty();
        }

        return onlineStatusRepository.isOnline(recipientId)
                .flatMap(online -> messageRepository.updateMessageInQueue(
                                recipientId, sessionId, messageId, senderId,
                                req.getEncryptedContent(), req.getIv(), editedAt)
                        .flatMap(updated -> {
                            if (Boolean.TRUE.equals(updated)) {
                                sendEditSuccessBoth(sessionId, messageId, req, editedAt,
                                        editorPrincipal, recipientId, online);
                                return Mono.<Void>empty();
                            }
                            return messageRepository.getDmMessageEditableMeta(sessionId, messageId)
                                    .flatMap(meta -> {
                                        if (!meta.getSenderId().equals(senderId)) {
                                            sendMessageEditError(editorPrincipal, sessionId, messageId, "NOT_OWNER");
                                            return Mono.<Void>empty();
                                        }
                                        if (isOutsideEditWindow(meta.getServerTimestamp())) {
                                            sendMessageEditError(
                                                    editorPrincipal, sessionId, messageId, "WINDOW_EXPIRED");
                                            return Mono.<Void>empty();
                                        }
                                        if (online) {
                                            sendEditSuccessBoth(sessionId, messageId, req, editedAt,
                                                    editorPrincipal, recipientId, true);
                                            return Mono.<Void>empty();
                                        }
                                        MessageEdit edit = MessageEdit.builder()
                                                .messageId(messageId)
                                                .sessionId(sessionId)
                                                .senderId(senderId)
                                                .encryptedContent(req.getEncryptedContent())
                                                .iv(req.getIv())
                                                .editedAt(editedAt)
                                                .build();
                                        return messageRepository.queueEdit(recipientId, sessionId, edit)
                                                .flatMap(ok -> {
                                                    if (!Boolean.TRUE.equals(ok)) {
                                                        sendMessageEditError(
                                                                editorPrincipal, sessionId, messageId,
                                                                "INTERNAL_ERROR");
                                                        return Mono.<Void>empty();
                                                    }
                                                    sendMessageEditSuccess(
                                                            editorPrincipal, sessionId, messageId, req, editedAt);
                                                    return Mono.<Void>empty();
                                                });
                                    })
                                    .switchIfEmpty(Mono.defer(() -> {
                                        long orig = req.getOriginalClientTimestamp();
                                        if (isOutsideEditWindow(Instant.ofEpochMilli(orig))) {
                                            sendMessageEditError(
                                                    editorPrincipal, sessionId, messageId, "WINDOW_EXPIRED");
                                        } else {
                                            sendMessageEditError(
                                                    editorPrincipal, sessionId, messageId, "NOT_EDITABLE");
                                        }
                                        return Mono.<Void>empty();
                                    }));
                        })
                );
    }

    private void sendEditSuccessBoth(
            String sessionId, String messageId, EditMessageRequest req, Instant editedAt,
            TelegramPrincipal editorPrincipal, Long recipientTelegramId, boolean recipientOnline) {
        MessageEditedEvent ok = buildMessageEditSuccess(sessionId, messageId, req, editedAt);
        stompUserMessenger.convertAndSendToUser(editorPrincipal, MESSAGE_EDITED_DESTINATION, ok);
        if (recipientOnline) {
            sendMessageEditedToTelegramRecipient(recipientTelegramId, ok);
        }
    }

    private MessageEditedEvent buildMessageEditSuccess(
            String sessionId, String messageId, EditMessageRequest req, Instant editedAt) {
        return MessageEditedEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .messageId(messageId)
                .encryptedContent(req.getEncryptedContent())
                .iv(req.getIv())
                .editedAt(editedAt)
                .build();
    }

    private void sendMessageEditSuccess(
            TelegramPrincipal editor, String sessionId, String messageId, EditMessageRequest req, Instant editedAt) {
        stompUserMessenger.convertAndSendToUser(
                editor, MESSAGE_EDITED_DESTINATION, buildMessageEditSuccess(sessionId, messageId, req, editedAt));
    }

    private void sendMessageEditedToTelegramRecipient(Long recipientTelegramId, MessageEditedEvent event) {
        userIdentityRepository.findByTelegramId(recipientTelegramId)
                .filter(StringUtils::hasText)
                .doOnNext(recipientInternalId -> {
                    LOG.debug(
                            "DM edit STOMP to peer: telegramId={}, internalId={}",
                            recipientTelegramId, recipientInternalId);
                    stompUserMessenger.convertAndSendToInternalId(
                            recipientInternalId, MESSAGE_EDITED_DESTINATION, event);
                })
                .switchIfEmpty(Mono.fromRunnable(() -> LOG.warn(
                        "DM edit peer STOMP skipped: no UserIdentity for telegramId={}, messageId={}",
                        recipientTelegramId, event.getMessageId())))
                .subscribe();
    }

    private void sendMessageEditError(TelegramPrincipal recipient, String sessionId,
            String messageId, String errorCode) {
        MessageEditedEvent event = MessageEditedEvent.builder()
                .success(false)
                .sessionId(sessionId)
                .messageId(messageId)
                .errorCode(errorCode)
                .build();
        stompUserMessenger.convertAndSendToUser(recipient, MESSAGE_EDITED_DESTINATION, event);
    }

    private static boolean isClientEditTimeImplausible(long originalClient, long editedAt) {
        Instant o = Instant.ofEpochMilli(originalClient);
        Instant e = Instant.ofEpochMilli(editedAt);
        return isOutsideEditWindow(o) || e.isBefore(o);
    }

    private static boolean isOutsideEditWindow(Instant baseServerOrClient) {
        if (baseServerOrClient == null) {
            return true;
        }
        return baseServerOrClient.plus(15, ChronoUnit.MINUTES).isBefore(Instant.now());
    }

}

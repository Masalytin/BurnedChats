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
import dev.burnedchats.model.MessageSenderIndexEntry;
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
import dev.burnedchats.util.ParticipantContext;
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
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * STOMP handler for encrypted message relay.
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

    private static final String NEW_MESSAGE_DESTINATION = "/queue/new-message";
    private static final String MESSAGE_SENT_DESTINATION = "/queue/message-sent";
    private static final String SYNC_MESSAGES_DESTINATION = "/queue/sync-messages";
    private static final String MESSAGE_EDITED_DESTINATION = "/queue/message-edited";
    private static final String MESSAGE_DELETED_DESTINATION = "/queue/message-deleted";

    private final SessionRepository sessionRepository;
    private final MessageRepository messageRepository;
    private final OnlineStatusRepository onlineStatusRepository;
    private final StompUserMessenger stompUserMessenger;
    private final BurnedChatsBot telegramBot;
    private final BotMessageService botMessages;
    private final FileMessageRelayValidator fileMessageRelayValidator;
    private final FileBurnService fileBurnService;
    private final OfflineQueueMetrics offlineQueueMetrics;

    @MessageMapping("/message.edit")
    public void editMessage(@Payload @Valid EditMessageRequest request, Principal principal) {
        ParticipantContext editor = ParticipantContext.from(principal);
        if (editor == null) {
            LOG.warn("message.edit: unsupported principal type {}", principal.getClass().getName());
            return;
        }
        String sessionId = request.getSessionId();
        String messageId = request.getMessageId();
        LOG.info("DM message edit: sessionId={}, messageId={}, internalId={}, telegramId={}",
                sessionId, messageId, editor.internalId(), editor.telegramId());

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    sendMessageEditError(editor, sessionId, messageId, "NOT_EDITABLE");
                    return Mono.empty();
                }))
                .flatMap(session -> applyDmEdit(session, editor, request))
                .subscribe(
                        v -> { },
                        error -> {
                            LOG.error("editMessage: sessionId={}, error={}", sessionId, error.getMessage());
                            sendMessageEditError(editor, sessionId, messageId, "INTERNAL_ERROR");
                        }
            );
    }

    @MessageMapping("/message.send")
    public void relayMessage(@Payload @Valid SendMessageRequest request, Principal principal) {
        ParticipantContext sender = ParticipantContext.from(principal);
        if (sender == null) {
            LOG.warn("message.send: unsupported principal type {}", principal.getClass().getName());
            return;
        }
        String sessionId = request.getSessionId();
        String messageId = request.getMessageId();

        LOG.info("Message relay requested: sessionId={}, internalId={}, messageId={}",
                sessionId, sender.internalId(), messageId);

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Session not found for message: {}", sessionId);
                    sendError(sender, sessionId, messageId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> validateAndRelayMessage(session, sender, request))
                .subscribe(
                        result -> { },
                        error -> {
                            LOG.error("Error relaying message: sessionId={}, internalId={}, error={}",
                                    sessionId, sender.internalId(), error.getMessage());
                            sendError(sender, sessionId, messageId, "INTERNAL_ERROR");
                        }
            );
    }

    @SuppressWarnings("checkstyle:MethodLength")
    @MessageMapping("/message.sync")
    public void syncMessages(@Payload @Valid SyncMessagesRequest request, Principal principal) {
        ParticipantContext participant = ParticipantContext.from(principal);
        if (participant == null) {
            LOG.warn("message.sync: unsupported principal type {}", principal.getClass().getName());
            return;
        }
        String internalId = participant.internalId();
        String sessionId = request.sessionId();

        LOG.info("Sync messages requested: sessionId={}, internalId={}, telegramId={}",
                sessionId, internalId, participant.telegramId());

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("Session not found for sync: {}", sessionId);
                    sendSyncError(participant, sessionId, "SESSION_NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> {
                    if (!session.isParticipant(internalId)) {
                        LOG.debug("User {} is not a participant in session {}", internalId, sessionId);
                        sendSyncError(participant, sessionId, "NOT_PARTICIPANT");
                        return Mono.empty();
                    }

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
                        stompUserMessenger.convertAndSendToInternalId(
                                internalId, SYNC_MESSAGES_DESTINATION, event);

                        LOG.info(
                                "Synced {} messages, {} edits, {} deletions for internalId={} in session {}",
                                syncedMessages.size(), syncedEdits.size(), deletedIds.size(), internalId, sessionId);

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
                        result -> { },
                        error -> {
                            LOG.error("Error syncing messages: sessionId={}, internalId={}, error={}",
                                    sessionId, internalId, error.getMessage());
                            sendSyncError(participant, sessionId, "INTERNAL_ERROR");
                        }
            );
    }

    @MessageMapping("/message.delete")
    public void deleteMessage(@Payload @Valid DeleteMessageRequest request, Principal principal) {
        ParticipantContext deleter = ParticipantContext.from(principal);
        if (deleter == null) {
            LOG.warn("message.delete: unsupported principal type {}", principal.getClass().getName());
            return;
        }
        String sessionId = request.getSessionId();
        String messageId = request.getMessageId();
        LOG.info("DM message delete: sessionId={}, messageId={}, internalId={}, telegramId={}",
                sessionId, messageId, deleter.internalId(), deleter.telegramId());

        sessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.defer(() -> {
                    sendMessageDeletedError(deleter, sessionId, messageId, "NOT_FOUND");
                    return Mono.empty();
                }))
                .flatMap(session -> runDmDelete(session, deleter, messageId))
                .subscribe(
                        v -> { },
                        error -> {
                            LOG.error("deleteMessage: sessionId={}, error={}", sessionId, error.getMessage());
                            sendMessageDeletedError(deleter, sessionId, messageId, "INTERNAL_ERROR");
                        }
            );
    }

    private Mono<Void> runDmDelete(Session session, ParticipantContext deleter, String messageId) {
        String sessionId = session.getId();
        if (!session.isParticipant(deleter.internalId())) {
            sendMessageDeletedError(deleter, sessionId, messageId, "NOT_PARTICIPANT");
            return Mono.empty();
        }
        if (session.getStatus() != SessionStatus.ACTIVE) {
            sendMessageDeletedError(deleter, sessionId, messageId,
                    errorCodeForNonActiveMessageSession(session.getStatus()));
            return Mono.empty();
        }
        String peerInternalId = session.getPeerInternalId(deleter.internalId());
        if (!StringUtils.hasText(peerInternalId)) {
            sendMessageDeletedError(deleter, sessionId, messageId, "INTERNAL_ERROR");
            return Mono.empty();
        }
        return messageRepository.removeMessageFromQueue(peerInternalId, sessionId, messageId)
                .flatMap(removed -> {
                    if (removed.isPresent()) {
                        if (!isMessageSender(removed.get(), deleter)) {
                            sendMessageDeletedError(deleter, sessionId, messageId, "NOT_ALLOWED");
                            return Mono.empty();
                        }
                        return finalizeDmDeleteFromQueue(
                                session, deleter, peerInternalId, messageId, removed.get());
                    }
                    return assertDeleterOwnsMessage(sessionId, messageId, deleter)
                            .flatMap(code -> {
                                if (!"OK".equals(code)) {
                                    sendMessageDeletedError(deleter, sessionId, messageId, code);
                                    return Mono.empty();
                                }
                                return messageRepository.getDmMessageEditableMeta(sessionId, messageId)
                                        .switchIfEmpty(Mono.just(DmMessageEditableMeta.builder().build()))
                                        .flatMap(meta -> finalizeDmDeleteDelivered(
                                                session, deleter, peerInternalId, messageId, meta));
                            });
                });
    }

    private static boolean isMessageSender(Message message, ParticipantContext participant) {
        if (message.getSenderInternalId() != null) {
            return message.getSenderInternalId().equals(participant.internalId());
        }
        return participant.telegramId() != null
                && Objects.equals(message.getSenderId(), participant.telegramId());
    }

    private Mono<String> assertDeleterOwnsMessage(String sessionId, String messageId,
            ParticipantContext deleter) {
        return messageRepository.getMessageSenderIndex(sessionId, messageId)
                .map(entry -> ownsIndexedMessage(entry, deleter) ? "OK" : "NOT_ALLOWED")
                .switchIfEmpty(Mono.defer(() ->
                        messageRepository.getDmMessageEditableMeta(sessionId, messageId)
                                .map(m -> ownsDeliveredMessage(m, deleter) ? "OK" : "NOT_ALLOWED")
                                .switchIfEmpty(Mono.just("NOT_FOUND"))
                ));
    }

    private static boolean ownsIndexedMessage(MessageSenderIndexEntry entry, ParticipantContext deleter) {
        if (entry == null) {
            return false;
        }
        String deleterInternalId = deleter.internalId();
        if (deleterInternalId != null && entry.getSenderInternalId() != null) {
            return deleterInternalId.equals(entry.getSenderInternalId());
        }
        Long tg = deleter.telegramId();
        if (tg != null && tg != 0 && entry.getSenderId() != null) {
            return tg.equals(entry.getSenderId());
        }
        return false;
    }

    private static boolean ownsDeliveredMessage(DmMessageEditableMeta meta, ParticipantContext deleter) {
        if (meta == null) {
            return false;
        }
        String editorInternalId = deleter.internalId();
        if (editorInternalId != null && meta.getSenderInternalId() != null) {
            return editorInternalId.equals(meta.getSenderInternalId());
        }
        Long tg = deleter.telegramId();
        if (tg != null && tg != 0 && meta.getSenderId() != null) {
            return tg.equals(meta.getSenderId());
        }
        return false;
    }

    private Mono<Void> finalizeDmDeleteFromQueue(
            Session session, ParticipantContext deleter, String peerInternalId, String messageId,
            Message fromQueue) {
        String sessionId = session.getId();
        if (FileMessageRelayValidator.isFileMessage(fromQueue.getType())) {
            fileBurnService.burnFiles(fromQueue.getFileId(), fromQueue.getThumbnailFileId());
        }
        return messageRepository.removeMessageSenderIndex(sessionId, messageId)
                .then(messageRepository.deleteDmMessageEditableMeta(sessionId, messageId))
                .then(broadcastDmDeleted(session, deleter, peerInternalId, messageId));
    }

    private Mono<Void> finalizeDmDeleteDelivered(
            Session session, ParticipantContext deleter, String peerInternalId, String messageId,
            DmMessageEditableMeta meta) {
        String sessionId = session.getId();
        if (meta != null && meta.getFileId() != null) {
            fileBurnService.burnFiles(meta.getFileId(), meta.getThumbnailFileId());
        }
        return messageRepository.removeMessageSenderIndex(sessionId, messageId)
                .then(messageRepository.deleteDmMessageEditableMeta(sessionId, messageId))
                .then(broadcastDmDeleted(session, deleter, peerInternalId, messageId));
    }

    private Mono<Void> broadcastDmDeleted(
            Session session, ParticipantContext deleter, String peerInternalId, String messageId) {
        String sessionId = session.getId();
        Instant deletedAt = Instant.now();
        MessageDeletedEvent ev = MessageDeletedEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .messageId(messageId)
                .deletedByTgId(deleter.telegramId())
                .deletedByOwner(false)
                .deletedAt(deletedAt)
                .build();
        sendDmMessageDeletedEvent(deleter, ev);
        MessageDeletion tomb = MessageDeletion.builder()
                .messageId(messageId)
                .deletedByTgId(deleter.telegramId())
                .deletedAt(deletedAt)
                .build();
        return onlineStatusRepository.isOnline(peerInternalId)
                .flatMap(online -> {
                    if (Boolean.TRUE.equals(online)) {
                        stompUserMessenger.convertAndSendToInternalId(
                                peerInternalId, MESSAGE_DELETED_DESTINATION, ev);
                        return Mono.<Void>empty();
                    }
                    return messageRepository.queueDeletion(peerInternalId, sessionId, tomb).then();
                });
    }

    private void sendDmMessageDeletedEvent(ParticipantContext deleter, MessageDeletedEvent event) {
        stompUserMessenger.convertAndSendToInternalId(
                deleter.internalId(), MESSAGE_DELETED_DESTINATION, event);
    }

    private void sendMessageDeletedError(ParticipantContext recipient, String sessionId, String messageId,
            String errorCode) {
        MessageDeletedEvent event = MessageDeletedEvent.builder()
                .success(false)
                .sessionId(sessionId)
                .messageId(messageId)
                .errorCode(errorCode)
                .build();
        stompUserMessenger.convertAndSendToInternalId(
                recipient.internalId(), MESSAGE_DELETED_DESTINATION, event);
    }

    private void sendSyncError(ParticipantContext recipient, String sessionId, String errorCode) {
        SyncMessagesEvent event = SyncMessagesEvent.error(sessionId, errorCode);
        stompUserMessenger.convertAndSendToInternalId(
                recipient.internalId(), SYNC_MESSAGES_DESTINATION, event);
    }

    @SuppressWarnings("checkstyle:MethodLength")
    private Mono<Void> validateAndRelayMessage(Session session, ParticipantContext sender,
                                               SendMessageRequest request) {
        String senderInternalId = sender.internalId();
        String sessionId = session.getId();
        String messageId = request.getMessageId();

        if (!session.isParticipant(senderInternalId)) {
            LOG.debug("User {} is not a participant in session {}", senderInternalId, sessionId);
            sendError(sender, sessionId, messageId, "NOT_PARTICIPANT");
            return Mono.empty();
        }

        SessionStatus status = session.getStatus();
        if (status != SessionStatus.ACTIVE) {
            LOG.debug("Session {} is not active, status: {}", sessionId, status);
            sendError(sender, sessionId, messageId, errorCodeForNonActiveMessageSession(status));
            return Mono.empty();
        }

        String recipientInternalId = session.getPeerInternalId(senderInternalId);
        if (!StringUtils.hasText(recipientInternalId)) {
            LOG.error("Could not determine recipient for sender {} in session {}",
                    senderInternalId, sessionId);
            sendError(sender, sessionId, messageId, "INTERNAL_ERROR");
            return Mono.empty();
        }
        Long recipientTelegramId = session.isInitiator(senderInternalId)
                ? session.getResponderTelegramId()
                : session.getInitiatorTelegramId();

        logReplyToIfPresent(request, sessionId);

        Mono<Void> fileValidation = Mono.empty();
        if (FileMessageRelayValidator.isFileMessage(request.getType())) {
            fileValidation = fileMessageRelayValidator.validateFileMessage(
                    request.getFileId(), request.getThumbnailFileId(),
                    sender.internalId(), sender.telegramId(), sessionId);
        }

        session.touch();

        return fileValidation
                .then(sessionRepository.save(session))
                .then(onlineStatusRepository.isOnline(recipientInternalId))
                .flatMap(isRecipientOnline -> {
                    Instant serverTimestamp = Instant.now();
                    if (Boolean.TRUE.equals(isRecipientOnline)) {
                        return deliverMessageImmediately(
                                session, sender, recipientInternalId, recipientTelegramId,
                                request, serverTimestamp);
                    }
                    return queueMessageForOfflineDelivery(
                            session, sender, recipientInternalId, recipientTelegramId,
                            request, serverTimestamp);
                })
                .onErrorResume(FileValidationException.class, ex -> {
                    LOG.debug("File validation failed for message {} in session {}: {}",
                            messageId, sessionId, ex.getErrorCode());
                    sendError(sender, sessionId, messageId, ex.getErrorCode());
                    return Mono.empty();
                });
    }

    @SuppressWarnings("checkstyle:MethodLength")
    private Mono<Void> deliverMessageImmediately(Session session, ParticipantContext sender,
            String recipientInternalId, Long recipientTelegramId,
            SendMessageRequest request, Instant serverTimestamp) {
        String sessionId = session.getId();
        String messageId = request.getMessageId();
        String type = request.getType() != null ? request.getType() : "text";

        NewMessageEvent.NewMessageEventBuilder eventBuilder = NewMessageEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .messageId(messageId)
                .senderId(sender.telegramId())
                .senderInternalId(sender.internalId())
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

        String fileId = FileMessageRelayValidator.isFileMessage(type) ? request.getFileId() : null;
        String thumbId = FileMessageRelayValidator.isFileMessage(type)
                ? request.getThumbnailFileId()
                : null;
        return messageRepository.putDmMessageEditableMeta(
                        sessionId, messageId, sender.internalId(), sender.telegramId(),
                        serverTimestamp, fileId, thumbId)
                .flatMap(metaOk -> {
                    if (!Boolean.TRUE.equals(metaOk)) {
                        // Best-effort: missing edit meta only degrades edit/delete, not delivery.
                        LOG.warn("Failed to store editable meta for immediate delivery: sessionId={}, messageId={}",
                                sessionId, messageId);
                    }
                    return messageRepository.putMessageSenderIndex(
                                    sessionId, messageId, sender.internalId(), sender.telegramId())
                            .flatMap(indexOk -> {
                                if (!Boolean.TRUE.equals(indexOk)) {
                                    LOG.warn(
                                            "Failed to store sender index for immediate delivery: "
                                                    + "sessionId={}, messageId={}",
                                            sessionId, messageId);
                                }
                                stompUserMessenger.convertAndSendToInternalId(
                                        recipientInternalId, NEW_MESSAGE_DESTINATION, newMessageEvent);
                                stompUserMessenger.convertAndSendToInternalId(
                                        sender.internalId(), MESSAGE_SENT_DESTINATION, sentEvent);

                                LOG.info(
                                        "Message delivered immediately: sessionId={}, messageId={}, type={}, "
                                                + "senderInternalId={}, recipientInternalId={}, "
                                                + "recipientTelegramId={}",
                                        sessionId, messageId, type, sender.internalId(), recipientInternalId,
                                        recipientTelegramId);
                                return Mono.<Void>empty();
                            });
                });
    }

    private Mono<Void> queueMessageForOfflineDelivery(Session session, ParticipantContext sender,
            String recipientInternalId, Long recipientTelegramId,
            SendMessageRequest request, Instant serverTimestamp) {
        String sessionId = session.getId();
        String messageId = request.getMessageId();
        Message message = buildQueuedMessage(session, sender, recipientInternalId, recipientTelegramId, request);

        return messageRepository.queueMessage(message)
                .flatMap(queued -> {
                    if (!queued) {
                        LOG.warn("Failed to queue message: sessionId={}, messageId={}", sessionId, messageId);
                        sendError(sender, sessionId, messageId, "QUEUE_FAILED");
                        return Mono.<Void>empty();
                    }

                    sendOfflineNotificationIfLinked(sender.telegramId(), recipientTelegramId, sessionId);

                    String queuedType = request.getType() != null ? request.getType() : "text";
                    String fileId = FileMessageRelayValidator.isFileMessage(queuedType) ? request.getFileId() : null;
                    String thumbId = FileMessageRelayValidator.isFileMessage(queuedType)
                            ? request.getThumbnailFileId()
                            : null;
                    return messageRepository
                            .putDmMessageEditableMeta(sessionId, messageId, sender.internalId(),
                                    sender.telegramId(), serverTimestamp, fileId, thumbId)
                            .flatMap(metaOk -> {
                                if (!Boolean.TRUE.equals(metaOk)) {
                                    // Best-effort: message already queued; meta only gates edit/delete.
                                    LOG.warn("Failed to store editable meta for queued message: sessionId={}, "
                                            + "messageId={}", sessionId, messageId);
                                }
                                return messageRepository.putMessageSenderIndex(
                                                sessionId, messageId, sender.internalId(), sender.telegramId())
                                        .flatMap(indexOk -> {
                                            if (!Boolean.TRUE.equals(indexOk)) {
                                                LOG.warn("Failed to store sender index for queued message: "
                                                        + "sessionId={}, messageId={}", sessionId, messageId);
                                            }
                                            MessageSentEvent sentEvent = MessageSentEvent.queued(
                                                    sessionId, messageId, serverTimestamp);
                                            stompUserMessenger.convertAndSendToInternalId(
                                                    sender.internalId(), MESSAGE_SENT_DESTINATION, sentEvent);

                                            LOG.info(
                                                    "Message queued for offline delivery: sessionId={}, messageId={}, "
                                                            + "senderInternalId={}, recipientInternalId={}",
                                                    sessionId, messageId, sender.internalId(), recipientInternalId);
                                            return Mono.<Void>empty();
                                        });
                            });
                });
    }

    @SuppressWarnings("checkstyle:ParameterNumber")
    private Message buildQueuedMessage(Session session, ParticipantContext sender,
            String recipientInternalId, Long recipientTelegramId, SendMessageRequest request) {
        String type = request.getType() != null ? request.getType() : "text";
        Message.MessageBuilder builder = Message.builder()
                .messageId(request.getMessageId())
                .sessionId(session.getId())
                .senderId(sender.telegramId())
                .senderInternalId(sender.internalId())
                .recipientId(recipientTelegramId)
                .recipientInternalId(recipientInternalId)
                .encryptedContent(request.getEncryptedContent())
                .iv(request.getIv())
                .clientTimestamp(request.getTimestamp())
                .serverTimestamp(Instant.now())
                .type(type)
                .replyToMessageId(request.getReplyToMessageId());
        if (FileMessageRelayValidator.isFileMessage(type)) {
            builder
                    .fileId(request.getFileId())
                    .thumbnailFileId(request.getThumbnailFileId())
                    .encryptedMeta(request.getEncryptedMeta())
                    .fileSize(request.getFileSize());
        }
        return builder.build();
    }

    private void sendOfflineNotificationIfLinked(Long senderTelegramId, Long recipientTelegramId,
            String sessionId) {
        if (recipientTelegramId == null) {
            LOG.debug("Telegram notification skip: recipient has no telegramId sessionId={}", sessionId);
            return;
        }
        botMessages.getForUser("bot.notify.newMessage", recipientTelegramId)
                .subscribe(notificationText -> {
                    boolean sent = telegramBot.sendNotificationWithButton(
                            recipientTelegramId,
                            notificationText,
                            "dm_" + sessionId
                    );
                    if (sent) {
                        LOG.info("Telegram notification sent to offline recipient {}: sessionId={}",
                                recipientTelegramId, sessionId);
                    } else {
                        LOG.warn("Failed to send Telegram notification to recipient {}", recipientTelegramId);
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

    private void sendError(ParticipantContext sender, String sessionId, String messageId, String errorCode) {
        MessageSentEvent event = MessageSentEvent.error(sessionId, messageId, errorCode);
        stompUserMessenger.convertAndSendToInternalId(
                sender.internalId(), MESSAGE_SENT_DESTINATION, event);
        LOG.trace("Sent message error to internalId={}, telegramId={}, code={}",
                sender.internalId(), sender.telegramId(), errorCode);
    }

    private void logReplyToIfPresent(SendMessageRequest request, String sessionId) {
        String replyTo = request.getReplyToMessageId();
        if (replyTo != null && !replyTo.isBlank()) {
            LOG.debug("message.send includes replyToMessageId={} sessionId={}", replyTo, sessionId);
        }
    }

    @SuppressWarnings("checkstyle:MethodLength")
    private Mono<Void> applyDmEdit(Session session, ParticipantContext editor, EditMessageRequest req) {
        String editorInternalId = editor.internalId();
        String sessionId = session.getId();
        String messageId = req.getMessageId();
        if (!session.isParticipant(editorInternalId)) {
            sendMessageEditError(editor, sessionId, messageId, "NOT_PARTICIPANT");
            return Mono.empty();
        }
        if (session.getStatus() != SessionStatus.ACTIVE) {
            sendMessageEditError(editor, sessionId, messageId,
                    errorCodeForNonActiveMessageSession(session.getStatus()));
            return Mono.empty();
        }
        String recipientInternalId = session.getPeerInternalId(editorInternalId);
        if (!StringUtils.hasText(recipientInternalId)) {
            sendMessageEditError(editor, sessionId, messageId, "INTERNAL_ERROR");
            return Mono.empty();
        }
        Instant editedAt = Instant.ofEpochMilli(req.getEditedAt());
        if (isClientEditTimestampAbusive(req.getOriginalClientTimestamp(), req.getEditedAt())) {
            sendMessageEditError(editor, sessionId, messageId, "WINDOW_EXPIRED");
            return Mono.empty();
        }

        return onlineStatusRepository.isOnline(recipientInternalId)
                .flatMap(online -> messageRepository.updateMessageInQueue(
                                recipientInternalId, sessionId, messageId,
                                editor.internalId(), editor.telegramId(),
                                req.getEncryptedContent(), req.getIv(), editedAt)
                        .flatMap(updated -> {
                            if (Boolean.TRUE.equals(updated)) {
                                sendEditSuccessBoth(sessionId, messageId, req, editedAt,
                                        editor, recipientInternalId, online);
                                return Mono.<Void>empty();
                            }
                            return messageRepository.getDmMessageEditableMeta(sessionId, messageId)
                                    .switchIfEmpty(Mono.defer(() -> {
                                        sendMessageEditError(editor, sessionId, messageId, "NOT_EDITABLE");
                                        return Mono.empty();
                                    }))
                                    .flatMap(meta -> {
                                        if (!ownsDeliveredMessage(meta, editor)) {
                                            sendMessageEditError(editor, sessionId, messageId, "NOT_OWNER");
                                            return Mono.<Void>empty();
                                        }
                                        if (isOutsideEditWindow(meta.getServerTimestamp())) {
                                            sendMessageEditError(editor, sessionId, messageId, "WINDOW_EXPIRED");
                                            return Mono.<Void>empty();
                                        }
                                        if (Boolean.TRUE.equals(online)) {
                                            sendEditSuccessBoth(sessionId, messageId, req, editedAt,
                                                    editor, recipientInternalId, true);
                                            return Mono.<Void>empty();
                                        }
                                        MessageEdit edit = MessageEdit.builder()
                                                .messageId(messageId)
                                                .sessionId(sessionId)
                                                .senderId(editor.telegramId())
                                                .encryptedContent(req.getEncryptedContent())
                                                .iv(req.getIv())
                                                .editedAt(editedAt)
                                                .build();
                                        return messageRepository.queueEdit(recipientInternalId, sessionId, edit)
                                                .flatMap(ok -> {
                                                    if (!Boolean.TRUE.equals(ok)) {
                                                        sendMessageEditError(
                                                                editor, sessionId, messageId, "INTERNAL_ERROR");
                                                        return Mono.<Void>empty();
                                                    }
                                                    sendMessageEditSuccess(editor, sessionId, messageId, req, editedAt);
                                                    return Mono.<Void>empty();
                                                });
                                    });
                        })
                );
    }

    private void sendEditSuccessBoth(
            String sessionId, String messageId, EditMessageRequest req, Instant editedAt,
            ParticipantContext editor, String recipientInternalId, boolean recipientOnline) {
        MessageEditedEvent ok = buildMessageEditSuccess(sessionId, messageId, req, editedAt);
        stompUserMessenger.convertAndSendToInternalId(editor.internalId(), MESSAGE_EDITED_DESTINATION, ok);
        if (recipientOnline) {
            stompUserMessenger.convertAndSendToInternalId(
                    recipientInternalId, MESSAGE_EDITED_DESTINATION, ok);
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
            ParticipantContext editor, String sessionId, String messageId,
            EditMessageRequest req, Instant editedAt) {
        stompUserMessenger.convertAndSendToInternalId(
                editor.internalId(),
                MESSAGE_EDITED_DESTINATION,
                buildMessageEditSuccess(sessionId, messageId, req, editedAt));
    }

    private void sendMessageEditError(ParticipantContext recipient, String sessionId,
            String messageId, String errorCode) {
        MessageEditedEvent event = MessageEditedEvent.builder()
                .success(false)
                .sessionId(sessionId)
                .messageId(messageId)
                .errorCode(errorCode)
                .build();
        stompUserMessenger.convertAndSendToInternalId(
                recipient.internalId(), MESSAGE_EDITED_DESTINATION, event);
    }

    /** Reject only abusive client timestamps; edit window is enforced from server meta. */
    private static boolean isClientEditTimestampAbusive(long originalClient, long editedAt) {
        Instant now = Instant.now();
        Instant e = Instant.ofEpochMilli(editedAt);
        if (e.isAfter(now.plus(5, ChronoUnit.MINUTES))) {
            return true;
        }
        Instant o = Instant.ofEpochMilli(originalClient);
        return e.isBefore(o.minus(1, ChronoUnit.MINUTES));
    }

    private static boolean isOutsideEditWindow(Instant baseServerOrClient) {
        if (baseServerOrClient == null) {
            return true;
        }
        return baseServerOrClient.plus(15, ChronoUnit.MINUTES).isBefore(Instant.now());
    }
}

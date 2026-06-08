package dev.burnedchats.handler;

import dev.burnedchats.dto.event.NewRoomMessageEvent;
import dev.burnedchats.dto.event.RoomMessageDeletedEvent;
import dev.burnedchats.dto.event.RoomMessageEditedEvent;
import dev.burnedchats.dto.event.RoomMessageSentEvent;
import dev.burnedchats.dto.event.SyncRoomMessagesEvent;
import dev.burnedchats.dto.request.DeleteRoomMessageRequest;
import dev.burnedchats.dto.request.EditRoomMessageRequest;
import dev.burnedchats.dto.request.SendRoomMessageRequest;
import dev.burnedchats.dto.request.SyncRoomMessagesRequest;
import dev.burnedchats.metrics.OfflineQueueMetrics;
import dev.burnedchats.metrics.OfflineSessionType;
import dev.burnedchats.model.RoomMessage;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomMessageRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.security.AppPrincipal;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.service.FileBurnService;
import dev.burnedchats.service.FileMessageRelayValidator;
import dev.burnedchats.service.FileMessageRelayValidator.FileValidationException;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.util.StringUtils;
import org.springframework.validation.annotation.Validated;
import reactor.core.publisher.Mono;

import java.security.Principal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * STOMP handler for room message relay and sync.
 *
 * <p>Handles encrypted message exchange within a room. The server acts
 * purely as a relay — it never decrypts group message content.
 * Messages are broadcast to all room subscribers and stored for offline delivery.
 *
 * <p>Sender identity uses {@link AppPrincipal#getInternalId()} throughout.
 *
 * @see SendRoomMessageRequest
 * @see NewRoomMessageEvent
 * @see SyncRoomMessagesEvent
 */
@Slf4j
@Controller
@Validated
@RequiredArgsConstructor
public class RoomMessageHandler {

    private static final String ROOM_TOPIC_PREFIX = "/topic/room/";
    private static final String ROOM_MESSAGE_SENT_DESTINATION = "/queue/room-message-sent";
    private static final String ROOM_MESSAGE_ERROR_DESTINATION = "/queue/room-message-error";
    private static final String ROOM_SYNC_DESTINATION = "/queue/room-sync-messages";
    private static final String ROOM_MESSAGE_EDITED_USER_DESTINATION = "/queue/room-message-edited";
    private static final String ROOM_MESSAGE_DELETED_USER_DESTINATION = "/queue/room-message-deleted";

    private final RoomMembersRepository roomMembersRepository;
    private final RoomMessageRepository roomMessageRepository;
    private final RoomRepository roomRepository;
    private final UserIdentityRepository userIdentityRepository;
    private final StompUserMessenger stompUserMessenger;
    private final SimpMessagingTemplate messagingTemplate;
    private final FileMessageRelayValidator fileMessageRelayValidator;
    private final FileBurnService fileBurnService;
    private final OfflineQueueMetrics offlineQueueMetrics;

    private record ParticipantContext(String internalId, Long telegramId) {
    }

    @SuppressWarnings("checkstyle:MethodLength")
    @MessageMapping("/room.message.edit")
    public void editRoomMessage(
            @Payload @Valid EditRoomMessageRequest request, Principal principal) {
        ParticipantContext editor = participantContext(principal);
        if (editor == null) {
            LOG.warn("room.message.edit: unsupported principal type {}", principal.getClass().getName());
            return;
        }
        String roomId = request.getRoomId();
        String messageId = request.getMessageId();

        LOG.info("ROOM_MESSAGE_EDIT: roomId={}, messageId={}, senderInternalId={}",
                roomId, messageId, editor.internalId());

        if (isRoomEditWindowExpired(request.getOriginalClientTimestamp(), request.getEditedAt())) {
            sendRoomMessageEditError(principal, roomId, messageId, "WINDOW_EXPIRED");
            return;
        }

        roomMembersRepository.isMember(roomId, editor.internalId())
                .flatMap(isMember -> {
                    if (!isMember) {
                        sendRoomMessageEditError(principal, roomId, messageId, "NOT_MEMBER");
                        return Mono.empty();
                    }
                    Instant editedAt = Instant.ofEpochMilli(request.getEditedAt());
                    return roomMessageRepository.updateMessage(
                                    roomId,
                                    messageId,
                                    editor.internalId(),
                                    request.getEncryptedContent(),
                                    request.getIv(),
                                    editedAt)
                            .flatMap(rm -> resolveDisplayName(rm.getSenderKey(), rm.getSenderTgId())
                                    .flatMap(senderName -> {
                                        RoomMessageEditedEvent ev = RoomMessageEditedEvent.builder()
                                                .success(true)
                                                .roomId(roomId)
                                                .messageId(rm.getMessageId())
                                                .senderInternalId(rm.getSenderKey())
                                                .senderTgId(rm.getSenderTgId())
                                                .senderName(senderName)
                                                .encryptedContent(rm.getEncryptedContent())
                                                .iv(rm.getIv())
                                                .editedAt(rm.getEditedAt())
                                                .type(rm.getType())
                                                .fileId(rm.getFileId())
                                                .thumbnailFileId(rm.getThumbnailFileId())
                                                .encryptedMeta(rm.getEncryptedMeta())
                                                .fileSize(rm.getFileSize())
                                                .build();
                                        messagingTemplate.convertAndSend(ROOM_TOPIC_PREFIX + roomId, ev);
                                        return extendRoomTtlAfterMutation(roomId);
                                    }))
                            .switchIfEmpty(Mono.defer(() -> {
                                sendRoomMessageEditError(principal, roomId, messageId, "NOT_EDITABLE");
                                return Mono.empty();
                            }));
                })
                .subscribe(
                        v -> { },
                        error -> {
                            LOG.error("ROOM_MESSAGE_EDIT failed: roomId={}, error={}", roomId, error.getMessage());
                            sendRoomMessageEditError(principal, roomId, messageId, "INTERNAL_ERROR");
                        }
            );
    }

    @SuppressWarnings("checkstyle:MethodLength")
    @MessageMapping("/room.message.delete")
    public void deleteRoomMessage(
            @Payload @Valid DeleteRoomMessageRequest request, Principal principal) {
        ParticipantContext actor = participantContext(principal);
        if (actor == null) {
            LOG.warn("room.message.delete: unsupported principal type {}", principal.getClass().getName());
            return;
        }
        String roomId = request.getRoomId();
        String messageId = request.getMessageId();
        LOG.info("ROOM_MESSAGE_DELETE: roomId={}, messageId={}, actorInternalId={}",
                roomId, messageId, actor.internalId());

        roomMembersRepository.isMember(roomId, actor.internalId())
                .flatMap(isMember -> {
                    if (!isMember) {
                        sendRoomMessageDeleteError(principal, roomId, messageId, "NOT_MEMBER");
                        return Mono.empty();
                    }
                    return roomRepository.findById(roomId)
                            .switchIfEmpty(Mono.defer(() -> {
                                sendRoomMessageDeleteError(principal, roomId, messageId, "NOT_FOUND");
                                return Mono.empty();
                            }))
                            .flatMap(room -> roomMessageRepository.findRoomMessageById(roomId, messageId)
                                    .flatMap(opt -> {
                                        if (opt.isEmpty()) {
                                            sendRoomMessageDeleteError(principal, roomId, messageId, "NOT_FOUND");
                                            return Mono.empty();
                                        }
                                        RoomMessage rm = opt.get();
                                        boolean own = actor.internalId().equals(rm.getSenderKey());
                                        boolean asOwner = !own
                                                && StringUtils.hasText(room.getOwnerInternalId())
                                                && room.getOwnerInternalId().equals(actor.internalId());
                                        if (!own && !asOwner) {
                                            sendRoomMessageDeleteError(principal, roomId, messageId, "NOT_ALLOWED");
                                            return Mono.empty();
                                        }
                                        return roomMessageRepository.removeRoomMessageValue(roomId, rm)
                                                .flatMap(ok -> {
                                                    if (!ok) {
                                                        sendRoomMessageDeleteError(
                                                                principal, roomId, messageId, "NOT_FOUND");
                                                        return Mono.empty();
                                                    }
                                                    if (FileMessageRelayValidator.isFileMessage(rm.getType())) {
                                                        fileBurnService.burnFiles(
                                                                rm.getFileId(), rm.getThumbnailFileId());
                                                    }
                                                    RoomMessageDeletedEvent ev = RoomMessageDeletedEvent.builder()
                                                            .eventType("ROOM_MESSAGE_DELETED")
                                                            .success(true)
                                                            .roomId(roomId)
                                                            .messageId(messageId)
                                                            .deletedByInternalId(actor.internalId())
                                                            .deletedByTgId(actor.telegramId())
                                                            .deletedByOwner(!own && asOwner)
                                                            .deletedAt(Instant.now())
                                                            .build();
                                                    messagingTemplate.convertAndSend(ROOM_TOPIC_PREFIX + roomId, ev);
                                                    return extendRoomTtlAfterMutation(roomId);
                                                });
                                    }));
                })
                .subscribe(
                        v -> { },
                        error -> {
                            LOG.error("ROOM_MESSAGE_DELETE failed: roomId={}, error={}", roomId, error.getMessage());
                            sendRoomMessageDeleteError(principal, roomId, messageId, "INTERNAL_ERROR");
                        }
            );
    }

    @MessageMapping("/room.message.send")
    public void sendRoomMessage(
            @Payload @Valid SendRoomMessageRequest request, Principal principal) {
        ParticipantContext sender = participantContext(principal);
        if (sender == null) {
            LOG.warn("room.message.send: unsupported principal type {}", principal.getClass().getName());
            return;
        }
        String roomId = request.getRoomId();
        String messageId = request.getMessageId();

        LOG.info("SEND_ROOM_MESSAGE: roomId={}, senderInternalId={}, messageId={}",
                roomId, sender.internalId(), messageId);

        roomMembersRepository.isMember(roomId, sender.internalId())
                .flatMap(isMember -> {
                    if (!isMember) {
                        LOG.debug("SEND_ROOM_MESSAGE rejected: user {} not a member of room {}",
                                sender.internalId(), roomId);
                        sendError(principal, roomId, messageId, "NOT_MEMBER");
                        return Mono.empty();
                    }

                    Mono<Void> fileValidation = Mono.empty();
                    if (FileMessageRelayValidator.isFileMessage(request.getType())) {
                        fileValidation = fileMessageRelayValidator.validateFileMessage(
                                request.getFileId(), request.getThumbnailFileId(),
                                sender.telegramId(), roomId);
                    }

                    return fileValidation
                            .then(Mono.defer(() -> saveAndBroadcast(request, sender, principal, roomId, messageId)));
                })
                .onErrorResume(FileValidationException.class, ex -> {
                    LOG.debug("File validation failed for room message {} in room {}: {}",
                            messageId, roomId, ex.getErrorCode());
                    sendError(principal, roomId, messageId, ex.getErrorCode());
                    return Mono.empty();
                })
                .subscribe(
                        result -> {},
                        error -> {
                            LOG.error("Error processing SEND_ROOM_MESSAGE: roomId={}, error={}",
                                    roomId, error.getMessage());
                            sendError(principal, roomId, messageId, "INTERNAL_ERROR");
                        }
            );
    }

    private Mono<Void> saveAndBroadcast(
            SendRoomMessageRequest request, ParticipantContext sender, Principal principal,
            String roomId, String messageId) {
        Instant serverTimestamp = Instant.now();
        String type = request.getType() != null ? request.getType() : "text";

        RoomMessage.RoomMessageBuilder msgBuilder = RoomMessage.builder()
                .messageId(messageId)
                .roomId(roomId)
                .senderInternalId(sender.internalId())
                .senderTgId(sender.telegramId())
                .encryptedContent(request.getEncryptedContent())
                .iv(request.getIv())
                .clientTimestamp(request.getTimestamp())
                .serverTimestamp(serverTimestamp)
                .type(type);

        if (FileMessageRelayValidator.isFileMessage(type)) {
            msgBuilder
                    .fileId(request.getFileId())
                    .thumbnailFileId(request.getThumbnailFileId())
                    .encryptedMeta(request.getEncryptedMeta())
                    .fileSize(request.getFileSize());
        }
        if (request.getReplyToMessageId() != null && !request.getReplyToMessageId().isBlank()) {
            msgBuilder.replyToMessageId(request.getReplyToMessageId());
        }

        RoomMessage message = msgBuilder.build();

        return roomMessageRepository.saveMessage(message)
                .flatMap(saved -> {
                    if (!saved) {
                        LOG.warn("Failed to save room message: roomId={}, messageId={}",
                                roomId, messageId);
                        sendError(principal, roomId, messageId, "SAVE_FAILED");
                        return Mono.<Void>empty();
                    }
                    return broadcastMessage(request, sender, principal, roomId, messageId, serverTimestamp);
                });
    }

    private Mono<Void> broadcastMessage(
            SendRoomMessageRequest request, ParticipantContext sender, Principal principal,
            String roomId, String messageId, Instant serverTimestamp) {
        String type = request.getType() != null ? request.getType() : "text";

        return resolveDisplayName(sender.internalId(), sender.telegramId())
                .flatMap(senderName -> {
                    NewRoomMessageEvent.NewRoomMessageEventBuilder eventBuilder =
                            NewRoomMessageEvent.builder()
                                    .success(true)
                                    .roomId(roomId)
                                    .messageId(messageId)
                                    .senderInternalId(sender.internalId())
                                    .senderTgId(sender.telegramId())
                                    .senderName(senderName)
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

                    eventBuilder.editedAt(null);
                    NewRoomMessageEvent event = eventBuilder.build();
                    messagingTemplate.convertAndSend(ROOM_TOPIC_PREFIX + roomId, event);
                    LOG.info("NEW_ROOM_MESSAGE broadcast: roomId={}, messageId={}, senderInternalId={}",
                            roomId, messageId, sender.internalId());
                    stompUserMessenger.convertAndSendToUserPrincipal(
                            principal,
                            ROOM_MESSAGE_SENT_DESTINATION,
                            RoomMessageSentEvent.success(roomId, messageId, serverTimestamp)
                    );
                    return extendRoomTtlAfterMutation(roomId);
                });
    }

    private Mono<Void> extendRoomTtlAfterMutation(String roomId) {
        return roomRepository.extendTtl(roomId, RoomRepository.DEFAULT_TTL)
                .doOnError(err -> LOG.warn(
                        "extendTtl failed after room mutation (already applied): roomId={}, error={}",
                        roomId, err.toString()))
                .onErrorComplete()
                .then();
    }

    @SuppressWarnings("checkstyle:MethodLength")
    @MessageMapping("/room.message.sync")
    public void syncRoomMessages(@Payload SyncRoomMessagesRequest request, Principal principal) {
        ParticipantContext requester = participantContext(principal);
        if (requester == null) {
            LOG.warn("room.message.sync: unsupported principal type {}", principal.getClass().getName());
            return;
        }
        String roomId = request.roomId();

        LOG.info("SYNC_ROOM_MESSAGES: roomId={}, requesterInternalId={}", roomId, requester.internalId());

        roomMembersRepository.isMember(roomId, requester.internalId())
                .flatMap(isMember -> {
                    if (!isMember) {
                        LOG.debug("SYNC_ROOM_MESSAGES rejected: user {} is not a member of room {}",
                                requester.internalId(), roomId);
                        sendSyncError(principal, roomId, "NOT_MEMBER");
                        return Mono.empty();
                    }

                    return roomMessageRepository.getRoomMessages(roomId)
                            .flatMap(msg -> resolveDisplayName(msg.getSenderKey(), msg.getSenderTgId())
                                    .map(senderName -> SyncRoomMessagesEvent.SyncedRoomMessage.builder()
                                            .messageId(msg.getMessageId())
                                            .senderInternalId(msg.getSenderKey())
                                            .senderTgId(msg.getSenderTgId())
                                            .senderName(senderName)
                                            .encryptedContent(msg.getEncryptedContent())
                                            .iv(msg.getIv())
                                            .clientTimestamp(msg.getClientTimestamp())
                                            .serverTimestamp(msg.getServerTimestamp())
                                            .type(msg.getType())
                                            .fileId(msg.getFileId())
                                            .thumbnailFileId(msg.getThumbnailFileId())
                                            .encryptedMeta(msg.getEncryptedMeta())
                                            .fileSize(msg.getFileSize())
                                            .replyToMessageId(msg.getReplyToMessageId())
                                            .editedAt(msg.getEditedAt())
                                            .build()))
                            .collectList()
                            .flatMap((List<SyncRoomMessagesEvent.SyncedRoomMessage> messages) -> {
                                SyncRoomMessagesEvent event = SyncRoomMessagesEvent.success(roomId, messages);
                                stompUserMessenger.convertAndSendToUserPrincipal(
                                        principal,
                                        ROOM_SYNC_DESTINATION,
                                        event
                                );
                                LOG.info("SYNC_ROOM_MESSAGES sent: roomId={}, requesterInternalId={}, count={}",
                                        roomId, requester.internalId(), messages.size());
                                offlineQueueMetrics.recordDelivered(OfflineSessionType.room, messages.size());
                                return Mono.empty();
                            });
                })
                .subscribe(
                        result -> {},
                        error -> {
                            LOG.error("Error processing SYNC_ROOM_MESSAGES: roomId={}, internalId={}, error={}",
                                    roomId, requester.internalId(), error.getMessage());
                            sendSyncError(principal, roomId, "INTERNAL_ERROR");
                        }
            );
    }

    private ParticipantContext participantContext(Principal principal) {
        if (!(principal instanceof AppPrincipal appPrincipal)) {
            return null;
        }
        Long telegramId = principal instanceof TelegramPrincipal telegramPrincipal
                ? telegramPrincipal.getUserId()
                : null;
        return new ParticipantContext(appPrincipal.getInternalId(), telegramId);
    }

    private Mono<String> resolveDisplayName(String internalId, Long telegramIdFallback) {
        if (!StringUtils.hasText(internalId)) {
            return Mono.just(fallbackDisplayName(telegramIdFallback));
        }
        return userIdentityRepository.findById(internalId)
                .map(UnifiedUser::displayName)
                .defaultIfEmpty(fallbackDisplayName(telegramIdFallback));
    }

    private static String fallbackDisplayName(Long telegramId) {
        return telegramId != null ? "User " + telegramId : "User";
    }

    private void sendError(Principal sender, String roomId, String messageId, String errorCode) {
        stompUserMessenger.convertAndSendToUserPrincipal(
                sender,
                ROOM_MESSAGE_SENT_DESTINATION,
                RoomMessageSentEvent.error(roomId, messageId, errorCode)
        );
        LOG.trace("Sent room message error to sender internalId={}: {}",
                sender instanceof AppPrincipal ap ? ap.getInternalId() : sender.getName(), errorCode);
    }

    private void sendSyncError(Principal requester, String roomId, String errorCode) {
        SyncRoomMessagesEvent event = SyncRoomMessagesEvent.error(roomId, errorCode);
        stompUserMessenger.convertAndSendToUserPrincipal(
                requester,
                ROOM_SYNC_DESTINATION,
                event
        );
        LOG.trace("Sent sync error to user internalId={}: {}",
                requester instanceof AppPrincipal ap ? ap.getInternalId() : requester.getName(), errorCode);
    }

    private void sendRoomMessageEditError(Principal requester, String roomId, String messageId,
            String errorCode) {
        RoomMessageEditedEvent event = RoomMessageEditedEvent.builder()
                .success(false)
                .roomId(roomId)
                .messageId(messageId)
                .errorCode(errorCode)
                .build();
        stompUserMessenger.convertAndSendToUserPrincipal(
                requester,
                ROOM_MESSAGE_EDITED_USER_DESTINATION,
                event
        );
    }

    private void sendRoomMessageDeleteError(Principal requester, String roomId, String messageId,
            String errorCode) {
        RoomMessageDeletedEvent event = RoomMessageDeletedEvent.builder()
                .eventType("ROOM_MESSAGE_DELETED")
                .success(false)
                .roomId(roomId)
                .messageId(messageId)
                .errorCode(errorCode)
                .build();
        stompUserMessenger.convertAndSendToUserPrincipal(
                requester,
                ROOM_MESSAGE_DELETED_USER_DESTINATION,
                event
        );
    }

    private static boolean isRoomEditWindowExpired(long originalClientTimestamp, long editedAtMs) {
        Instant o = Instant.ofEpochMilli(originalClientTimestamp);
        Instant e = Instant.ofEpochMilli(editedAtMs);
        if (e.isBefore(o)) {
            return true;
        }
        return o.plus(15, ChronoUnit.MINUTES).isBefore(Instant.now());
    }
}

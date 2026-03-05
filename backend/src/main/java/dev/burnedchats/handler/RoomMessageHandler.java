package dev.burnedchats.handler;

import dev.burnedchats.dto.event.NewRoomMessageEvent;
import dev.burnedchats.dto.event.RoomMessageSentEvent;
import dev.burnedchats.dto.event.SyncRoomMessagesEvent;
import dev.burnedchats.dto.request.SendRoomMessageRequest;
import dev.burnedchats.dto.request.SyncRoomMessagesRequest;
import dev.burnedchats.model.RoomMessage;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomMessageRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.repository.UserRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import jakarta.validation.Valid;
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
 * STOMP handler for room message relay and sync.
 *
 * <p>Handles encrypted message exchange within a room. The server acts
 * purely as a relay — it never decrypts group message content.
 * Messages are broadcast to all room subscribers and stored for offline delivery.
 *
 * <p>Message flow for SEND_ROOM_MESSAGE:
 * <ol>
 *   <li>Sender encrypts message with room group key (client-side)</li>
 *   <li>Sender sends via {@code /app/room.message.send}</li>
 *   <li>Server validates sender is a room member</li>
 *   <li>Server saves message to {@code messages:{roomId}} (TTL 24h)</li>
 *   <li>Server broadcasts {@code NEW_ROOM_MESSAGE} to {@code /topic/room/{roomId}}</li>
 * </ol>
 *
 * <p>Message flow for SYNC_ROOM_MESSAGES:
 * <ol>
 *   <li>Client connects or reconnects to a room</li>
 *   <li>Client sends via {@code /app/room.message.sync}</li>
 *   <li>Server validates user is a room member</li>
 *   <li>Server returns all stored messages from {@code messages:{roomId}}</li>
 * </ol>
 *
 * <p>Destinations handled:
 * <ul>
 *   <li>{@code /app/room.message.send} — send encrypted room message</li>
 *   <li>{@code /app/room.message.sync} — sync offline room messages</li>
 * </ul>
 *
 * <p>Events sent:
 * <ul>
 *   <li>{@code /topic/room/{roomId}} — NEW_ROOM_MESSAGE broadcast to all room subscribers</li>
 *   <li>{@code /user/queue/room-message-error} — error feedback to sender</li>
 *   <li>{@code /user/queue/room-sync-messages} — SYNC_ROOM_MESSAGES response to requester</li>
 * </ul>
 *
 * <p>Security contract:
 * <ul>
 *   <li>Sender must be a member of the room (validated against {@code room_members:{roomId}})</li>
 *   <li>Encrypted content is never decrypted by the server</li>
 *   <li>senderTgId is included in the event for display purposes only</li>
 * </ul>
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

    /**
     * STOMP topic for broadcasting new messages to all room subscribers.
     */
    private static final String ROOM_TOPIC_PREFIX = "/topic/room/";

    /**
     * STOMP destination for delivery acknowledgment sent back to the sender.
     */
    private static final String ROOM_MESSAGE_SENT_DESTINATION = "/queue/room-message-sent";

    /**
     * STOMP destination for error events sent back to the sender.
     */
    private static final String ROOM_MESSAGE_ERROR_DESTINATION = "/queue/room-message-error";

    /**
     * STOMP destination for sync response sent to the requesting user.
     */
    private static final String ROOM_SYNC_DESTINATION = "/queue/room-sync-messages";

    private final RoomMembersRepository roomMembersRepository;
    private final RoomMessageRepository roomMessageRepository;
    private final RoomRepository roomRepository;
    private final UserRepository userRepository;
    private final SimpMessagingTemplate messagingTemplate;

    /**
     * Handle {@code SEND_ROOM_MESSAGE} — relay an encrypted message to all room subscribers.
     *
     * <p>Validates that the sender is a room member, saves the message to Redis,
     * and broadcasts a {@code NEW_ROOM_MESSAGE} event to {@code /topic/room/{roomId}}.
     *
     * @param request   the send message request containing encrypted content
     * @param principal authenticated user principal
     */
    @MessageMapping("/room.message.send")
    public void sendRoomMessage(
            @Payload @Valid SendRoomMessageRequest request, Principal principal) {
        TelegramPrincipal tp = (TelegramPrincipal) principal;
        Long senderTgId = tp.getUserId();
        String roomId = request.getRoomId();
        String messageId = request.getMessageId();

        log.info("SEND_ROOM_MESSAGE: roomId={}, senderTgId={}, messageId={}",
                roomId, senderTgId, messageId);

        roomMembersRepository.isMember(roomId, senderTgId)
                .flatMap(isMember -> {
                    if (!isMember) {
                        log.debug("SEND_ROOM_MESSAGE rejected: user {} not a member of room {}",
                                senderTgId, roomId);
                        sendError(senderTgId, roomId, messageId, "NOT_MEMBER");
                        return Mono.empty();
                    }
                    return saveAndBroadcast(request, senderTgId, roomId, messageId);
                })
                .subscribe(
                        result -> {},
                        error -> {
                            log.error("Error processing SEND_ROOM_MESSAGE: roomId={}, error={}",
                                    roomId, error.getMessage());
                            sendError(senderTgId, roomId, messageId, "INTERNAL_ERROR");
                        }
                );
    }

    private Mono<Void> saveAndBroadcast(
            SendRoomMessageRequest request, Long senderTgId, String roomId, String messageId) {
        Instant serverTimestamp = Instant.now();
        RoomMessage message = RoomMessage.builder()
                .messageId(messageId)
                .roomId(roomId)
                .senderTgId(senderTgId)
                .encryptedContent(request.getEncryptedContent())
                .iv(request.getIv())
                .clientTimestamp(request.getTimestamp())
                .serverTimestamp(serverTimestamp)
                .build();

        return roomMessageRepository.saveMessage(message)
                .flatMap(saved -> {
                    if (!saved) {
                        log.warn("Failed to save room message: roomId={}, messageId={}",
                                roomId, messageId);
                        sendError(senderTgId, roomId, messageId, "SAVE_FAILED");
                        return Mono.<Void>empty();
                    }
                    return broadcastMessage(request, senderTgId, roomId, messageId, serverTimestamp);
                });
    }

    private Mono<Void> broadcastMessage(
            SendRoomMessageRequest request, Long senderTgId, String roomId,
            String messageId, Instant serverTimestamp) {
        return userRepository.getDisplayName(senderTgId)
                .defaultIfEmpty("User " + senderTgId)
                .flatMap(senderName -> {
                    NewRoomMessageEvent event = NewRoomMessageEvent.builder()
                            .success(true)
                            .roomId(roomId)
                            .messageId(messageId)
                            .senderTgId(senderTgId)
                            .senderName(senderName)
                            .encryptedContent(request.getEncryptedContent())
                            .iv(request.getIv())
                            .clientTimestamp(request.getTimestamp())
                            .serverTimestamp(serverTimestamp)
                            .build();
                    messagingTemplate.convertAndSend(ROOM_TOPIC_PREFIX + roomId, event);
                    log.info("NEW_ROOM_MESSAGE broadcast: roomId={}, messageId={}, senderTgId={}",
                            roomId, messageId, senderTgId);
                    // Send delivery acknowledgment back to sender so the client can
                    // transition the message status from 'sending' to 'sent'.
                    messagingTemplate.convertAndSendToUser(
                            String.valueOf(senderTgId),
                            ROOM_MESSAGE_SENT_DESTINATION,
                            RoomMessageSentEvent.success(roomId, messageId, serverTimestamp)
                    );
                    return roomRepository.extendTtl(roomId, RoomRepository.DEFAULT_TTL).then();
                });
    }

    /**
     * Handle {@code SYNC_ROOM_MESSAGES} — return all stored messages for a room.
     *
     * <p>Called when a client connects or reconnects to a room. Returns all messages
     * currently in {@code messages:{roomId}}. The client deduplicates by messageId.
     *
     * @param request   the sync request containing roomId
     * @param principal authenticated user principal
     */
    @MessageMapping("/room.message.sync")
    public void syncRoomMessages(@Payload SyncRoomMessagesRequest request, Principal principal) {
        TelegramPrincipal tp = (TelegramPrincipal) principal;
        Long userId = tp.getUserId();
        String roomId = request.roomId();

        log.info("SYNC_ROOM_MESSAGES: roomId={}, userId={}", roomId, userId);

        roomMembersRepository.isMember(roomId, userId)
                .flatMap(isMember -> {
                    if (!isMember) {
                        log.debug("SYNC_ROOM_MESSAGES rejected: user {} is not a member of room {}", userId, roomId);
                        sendSyncError(userId, roomId, "NOT_MEMBER");
                        return Mono.empty();
                    }

                    return roomMessageRepository.getRoomMessages(roomId)
                            .flatMap(msg -> userRepository.getDisplayName(msg.getSenderTgId())
                                    .defaultIfEmpty("User " + msg.getSenderTgId())
                                    .map(senderName -> SyncRoomMessagesEvent.SyncedRoomMessage.builder()
                                            .messageId(msg.getMessageId())
                                            .senderTgId(msg.getSenderTgId())
                                            .senderName(senderName)
                                            .encryptedContent(msg.getEncryptedContent())
                                            .iv(msg.getIv())
                                            .clientTimestamp(msg.getClientTimestamp())
                                            .serverTimestamp(msg.getServerTimestamp())
                                            .build()))
                            .collectList()
                            .flatMap((List<SyncRoomMessagesEvent.SyncedRoomMessage> messages) -> {
                                SyncRoomMessagesEvent event = SyncRoomMessagesEvent.success(roomId, messages);
                                messagingTemplate.convertAndSendToUser(
                                        String.valueOf(userId),
                                        ROOM_SYNC_DESTINATION,
                                        event
                                );
                                log.info("SYNC_ROOM_MESSAGES sent: roomId={}, userId={}, count={}",
                                        roomId, userId, messages.size());
                                return Mono.empty();
                            });
                })
                .subscribe(
                        result -> {},
                        error -> {
                            log.error("Error processing SYNC_ROOM_MESSAGES: roomId={}, userId={}, error={}",
                                    roomId, userId, error.getMessage());
                            sendSyncError(userId, roomId, "INTERNAL_ERROR");
                        }
                );
    }

    private void sendError(Long senderTgId, String roomId, String messageId, String errorCode) {
        messagingTemplate.convertAndSendToUser(
                String.valueOf(senderTgId),
                ROOM_MESSAGE_SENT_DESTINATION,
                RoomMessageSentEvent.error(roomId, messageId, errorCode)
        );
        log.trace("Sent room message error to sender {}: {}", senderTgId, errorCode);
    }

    private void sendSyncError(Long userId, String roomId, String errorCode) {
        SyncRoomMessagesEvent event = SyncRoomMessagesEvent.error(roomId, errorCode);
        messagingTemplate.convertAndSendToUser(
                String.valueOf(userId),
                ROOM_SYNC_DESTINATION,
                event
        );
        log.trace("Sent sync error to user {}: {}", userId, errorCode);
    }
}

package dev.burnedchats.websocket;

import dev.burnedchats.config.MessagesProperties;
import dev.burnedchats.dto.event.IncomingRequestEvent;
import dev.burnedchats.metrics.OfflineQueueMetrics;
import dev.burnedchats.metrics.OfflineSessionType;
import dev.burnedchats.dto.event.SyncMessagesEvent;
import dev.burnedchats.dto.event.SyncMessagesEvent.SyncedEdit;
import dev.burnedchats.dto.event.SyncMessagesEvent.SyncedMessage;
import dev.burnedchats.dto.mapper.UserMapper;
import dev.burnedchats.dto.response.UserResponse;
import dev.burnedchats.model.ChatRequest;
import dev.burnedchats.model.Message;
import dev.burnedchats.model.MessageDeletion;
import dev.burnedchats.model.MessageEdit;
import dev.burnedchats.model.TelegramUser;
import dev.burnedchats.repository.MessageRepository;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.RequestRepository;
import dev.burnedchats.repository.UserRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionConnectedEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;
import reactor.core.publisher.Mono;

import java.security.Principal;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

import reactor.core.publisher.Flux;

/**
 * WebSocket event listener for handling connection lifecycle events.
 *
 * <p>This component handles:
 * <ul>
 *   <li>Session connection - marks user online, sends pending requests</li>
 *   <li>Session disconnection - marks user offline</li>
 * </ul>
 *
 * <p>When a user connects, any pending incoming chat requests are
 * immediately sent to them via WebSocket, fulfilling task 3.4.1.
 *
 * @see OnlineStatusRepository
 * @see RequestRepository
 */
@Slf4j
@Component
@RequiredArgsConstructor
@SuppressWarnings("checkstyle:JavadocMethod")
public class WebSocketEventListener {

    /**
     * STOMP destination for incoming request events.
     */
    private static final String INCOMING_REQUEST_DESTINATION = "/queue/incoming-request";

    /**
     * STOMP destination for synced messages (server-initiated fan-out).
     */
    private static final String SYNC_MESSAGES_DESTINATION = "/queue/sync-messages";

    private final OnlineStatusRepository onlineStatusRepository;
    private final RequestRepository requestRepository;
    private final UserRepository userRepository;
    private final MessageRepository messageRepository;
    private final UserMapper userMapper;
    private final SimpMessagingTemplate messagingTemplate;
    private final MessagesProperties messagesProperties;
    private final OfflineQueueMetrics offlineQueueMetrics;

    /**
     * Handle WebSocket session connected event.
     *
     * <p>When a user connects:
     * <ol>
     *   <li>Mark the user as online in Redis</li>
     *   <li>Check for pending chat requests</li>
     *   <li>Send INCOMING_REQUEST events for each pending request</li>
     * </ol>
     *
     * @param event the session connected event
     */
    @EventListener
    public void handleSessionConnected(SessionConnectedEvent event) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(event.getMessage());
        Principal principal = accessor.getUser();

        if (principal == null) {
            LOG.warn("Session connected without principal: sessionId={}",
                    accessor.getSessionId());
            return;
        }

        if (principal instanceof TelegramPrincipal telegramPrincipal) {
            Long telegramUserId = telegramPrincipal.getUserId();
            String internalId = telegramPrincipal.getInternalId();
            String sessionId = accessor.getSessionId();

            LOG.info("User connected: internalId={}, telegramId={}, sessionId={}",
                    internalId, telegramUserId, sessionId);

            // Mark user as online
            onlineStatusRepository.setOnline(internalId)
                    .doOnSuccess(v -> LOG.debug("User {} marked as online", internalId))
                    .subscribe();

            // Cache user info if not already cached
            cacheUserInfo(telegramPrincipal);

            // Send pending requests to the user (Task 3.4.1)
            sendPendingRequests(internalId);

            // Server-initiated fan-out sync of pending offline messages
            // (FIX-SYNC-4) — guards against clients that fail to request
            // /app/message.sync themselves.
            if (messagesProperties.getServerPushSync().isEnabled()) {
                pushPendingMessagesFanOut(internalId);
            }
        }
    }

    /**
     * Handle WebSocket session disconnect event.
     *
     * <p>When a user disconnects:
     * <ol>
     *   <li>Mark the user as offline in Redis</li>
     *   <li>Log the disconnection for debugging</li>
     * </ol>
     *
     * @param event the session disconnect event
     */
    @EventListener
    public void handleSessionDisconnect(SessionDisconnectEvent event) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(event.getMessage());
        Principal principal = accessor.getUser();

        if (principal instanceof TelegramPrincipal telegramPrincipal) {
            String internalId = telegramPrincipal.getInternalId();

            LOG.info("User disconnected: internalId={}, sessionId={}, closeStatus={}",
                    internalId, event.getSessionId(), event.getCloseStatus());

            // Mark user as offline
            onlineStatusRepository.setOffline(internalId)
                    .doOnSuccess(v -> LOG.debug("User {} marked as offline", internalId))
                    .subscribe();
        }
    }

    /**
     * Cache user info from the principal for later use.
     *
     * @param principal the Telegram principal
     */
    private void cacheUserInfo(TelegramPrincipal principal) {
        TelegramUser user = TelegramUser.builder()
                .id(principal.getUserId())
                .username(principal.getUsername())
                .firstName(principal.getFirstName())
                .lastName(principal.getLastName())
                .isPremium(principal.isPremium())
                .build();

        userRepository.save(user)
                .doOnSuccess(v -> LOG.debug("User {} cached", user.getId()))
                .subscribe();
    }

    /**
     * Send all pending incoming requests to a user.
     *
     * <p>This is called when a user connects to ensure they receive
     * any chat requests that arrived while they were offline.
     *
     * @param internalId recipient {@link dev.burnedchats.model.UnifiedUser#internalId()} (STOMP user name)
     */
    private void sendPendingRequests(String internalId) {
        requestRepository.findByRecipient(internalId)
                .flatMap(request -> buildIncomingRequestEvent(request)
                        .doOnNext(event -> {
                            messagingTemplate.convertAndSendToUser(
                                    internalId,
                                    INCOMING_REQUEST_DESTINATION,
                                    event
                            );
                            LOG.info("Sent pending request to user {}: sessionId={}",
                                    internalId, event.getSessionId());
                        }))
                .subscribe(
                        event -> {},
                        error -> LOG.error("Error sending pending requests to user {}: {}",
                                internalId, error.getMessage()),
                        () -> LOG.debug("Finished sending pending requests to user {}", internalId)
            );
    }

    /**
     * Build an IncomingRequestEvent from a ChatRequest.
     *
     * @param request the chat request
     * @return Mono of IncomingRequestEvent
     */
    private reactor.core.publisher.Mono<IncomingRequestEvent> buildIncomingRequestEvent(
            ChatRequest request) {
        return userRepository.findById(request.getSenderTgId())
                .map(sender -> userMapper.toResponse(sender, true))
                .defaultIfEmpty(buildPlaceholderSender(request))
                .map(senderResponse -> IncomingRequestEvent.create(
                        request.getSessionId(),
                        senderResponse,
                        request.getQuestion(),
                        request.getCreatedAt(),
                        request.getExpiresAt()
                ));
    }

    /**
     * Build a placeholder sender response when user info is not cached.
     *
     * @param request the chat request with sender info
     * @return placeholder UserResponse
     */
    private UserResponse buildPlaceholderSender(ChatRequest request) {
        String displayName = request.getSenderFirstName();
        if (request.getSenderLastName() != null) {
            displayName += " " + request.getSenderLastName();
        }

        return UserResponse.builder()
                .id(request.getSenderTgId())
                .username(request.getSenderUsername())
                .displayName(displayName)
                .photoUrl(request.getSenderPhotoUrl())
                .online(true)
                .premium(false)
                .build();
    }

    /**
     * Fan out pending offline messages to the freshly-connected user.
     *
     * <p>Locates all sessions with pending messages via
     * {@link MessageRepository#findSessionsWithPendingMessages(String)}
     * and, for each one, emits a {@link SyncMessagesEvent} over
     * {@code /user/queue/sync-messages}. The Redis queue is cleared only
     * after the event is handed off to the messaging template, so that a
     * race with a client-initiated {@code /app/message.sync} is safe
     * (the second response will simply contain {@code count: 0}).
     *
     * @param internalId {@link dev.burnedchats.model.UnifiedUser#internalId()} of the user that just connected
     */
    private void pushPendingMessagesFanOut(String internalId) {
        int concurrency = Math.max(1, messagesProperties.getServerPushSync().getConcurrency());

        AtomicInteger sessionCount = new AtomicInteger(0);
        AtomicInteger messageCount = new AtomicInteger(0);

        Flux.merge(
                        messageRepository.findSessionsWithPendingMessages(internalId),
                        messageRepository.findSessionsWithPendingDeletions(internalId),
                        messageRepository.findSessionsWithPendingEdits(internalId))
                .distinct()
                .flatMap(sessionId -> pushPendingMessagesForSession(internalId, sessionId)
                        .doOnNext(delivered -> {
                            if (delivered > 0) {
                                sessionCount.incrementAndGet();
                                messageCount.addAndGet(delivered);
                            }
                        }), concurrency)
                .then()
                .subscribe(
                        v -> {},
                        error -> LOG.error(
                                "Error during server-push sync fan-out for internalId {}: {}",
                                internalId, error.getMessage()),
                        () -> {
                            int sessions = sessionCount.get();
                            int messages = messageCount.get();
                            if (sessions > 0) {
                                LOG.info(
                                        "Server-push sync: internalId={}, sessions={}, messages={}",
                                        internalId, sessions, messages);
                            } else {
                                LOG.debug(
                                        "Server-push sync: internalId={}, no pending messages",
                                        internalId);
                            }
                        }
            );
    }

    /**
     * Send a {@link SyncMessagesEvent} for a single session and clear its
     * queue on success.
     *
     * <p>Emits no STOMP message when the queue turns out to be empty
     * (e.g. another fan-out or an explicit client sync drained it), to
     * avoid a pointless {@code count: 0} event.
     *
     * @param internalId recipient {@link dev.burnedchats.model.UnifiedUser#internalId()}
     * @param sessionId the session whose queue should be drained
     * @return mono of the number of messages delivered (0 if none)
     */
    private Mono<Integer> pushPendingMessagesForSession(String internalId, String sessionId) {
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
            List<SyncedEdit> syncedEdits = pendingEdits.stream()
                    .filter(e -> !deletedIdSet.contains(e.getMessageId()))
                    .map(SyncedEdit::fromMessageEdit)
                    .toList();
            List<String> deletedIds = deletions.stream()
                    .map(MessageDeletion::getMessageId)
                    .toList();
            if (messages.isEmpty() && syncedEdits.isEmpty() && deletedIds.isEmpty()) {
                return Mono.just(0);
            }
            List<SyncedMessage> syncedMessages = messages.stream()
                    .map(SyncedMessage::fromMessage)
                    .toList();
            SyncMessagesEvent event = SyncMessagesEvent.success(sessionId, syncedMessages, deletedIds, syncedEdits);

            messagingTemplate.convertAndSendToUser(
                    internalId,
                    SYNC_MESSAGES_DESTINATION,
                    event
            );

            LOG.debug("Server-push sync: {} messages, {} edits, {} deletions, internalId {} session {}",
                    messages.size(), syncedEdits.size(), deletedIds.size(), internalId, sessionId);

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
            return after.thenReturn(messages.size() + pendingEdits.size() + deletions.size());
        })
                .onErrorResume(error -> {
                    LOG.error("Server-push sync failed for internalId {} session {}: {}",
                            internalId, sessionId, error.getMessage());
                    return Mono.just(0);
                });
    }
}

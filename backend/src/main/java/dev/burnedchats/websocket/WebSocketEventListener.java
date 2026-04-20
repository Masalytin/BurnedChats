package dev.burnedchats.websocket;

import dev.burnedchats.config.MessagesProperties;
import dev.burnedchats.dto.event.IncomingRequestEvent;
import dev.burnedchats.dto.event.SyncMessagesEvent;
import dev.burnedchats.dto.event.SyncMessagesEvent.SyncedMessage;
import dev.burnedchats.dto.mapper.UserMapper;
import dev.burnedchats.dto.response.UserResponse;
import dev.burnedchats.model.ChatRequest;
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
import java.util.concurrent.atomic.AtomicInteger;

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
            log.warn("Session connected without principal: sessionId={}",
                    accessor.getSessionId());
            return;
        }

        if (principal instanceof TelegramPrincipal telegramPrincipal) {
            Long userId = telegramPrincipal.getUserId();
            String sessionId = accessor.getSessionId();

            log.info("User connected: userId={}, sessionId={}", userId, sessionId);

            // Mark user as online
            onlineStatusRepository.setOnline(userId)
                    .doOnSuccess(v -> log.debug("User {} marked as online", userId))
                    .subscribe();

            // Cache user info if not already cached
            cacheUserInfo(telegramPrincipal);

            // Send pending requests to the user (Task 3.4.1)
            sendPendingRequests(userId);

            // Server-initiated fan-out sync of pending offline messages
            // (FIX-SYNC-4) — guards against clients that fail to request
            // /app/message.sync themselves.
            if (messagesProperties.getServerPushSync().isEnabled()) {
                pushPendingMessagesFanOut(userId);
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
            Long userId = telegramPrincipal.getUserId();

            log.info("User disconnected: userId={}, sessionId={}, closeStatus={}",
                    userId, event.getSessionId(), event.getCloseStatus());

            // Mark user as offline
            onlineStatusRepository.setOffline(userId)
                    .doOnSuccess(v -> log.debug("User {} marked as offline", userId))
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
                .doOnSuccess(v -> log.debug("User {} cached", user.getId()))
                .subscribe();
    }

    /**
     * Send all pending incoming requests to a user.
     *
     * <p>This is called when a user connects to ensure they receive
     * any chat requests that arrived while they were offline.
     *
     * @param userId the user's Telegram ID
     */
    private void sendPendingRequests(Long userId) {
        requestRepository.findByRecipient(userId)
                .flatMap(request -> buildIncomingRequestEvent(request)
                        .doOnNext(event -> {
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(userId),
                                    INCOMING_REQUEST_DESTINATION,
                                    event
                            );
                            log.info("Sent pending request to user {}: sessionId={}",
                                    userId, event.getSessionId());
                        }))
                .subscribe(
                        event -> {},
                        error -> log.error("Error sending pending requests to user {}: {}",
                                userId, error.getMessage()),
                        () -> log.debug("Finished sending pending requests to user {}", userId)
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
     * {@link MessageRepository#findSessionsWithPendingMessages(Long)}
     * and, for each one, emits a {@link SyncMessagesEvent} over
     * {@code /user/queue/sync-messages}. The Redis queue is cleared only
     * after the event is handed off to the messaging template, so that a
     * race with a client-initiated {@code /app/message.sync} is safe
     * (the second response will simply contain {@code count: 0}).
     *
     * @param userId the Telegram user ID that just connected
     */
    private void pushPendingMessagesFanOut(Long userId) {
        int concurrency = Math.max(1, messagesProperties.getServerPushSync().getConcurrency());

        AtomicInteger sessionCount = new AtomicInteger(0);
        AtomicInteger messageCount = new AtomicInteger(0);

        messageRepository.findSessionsWithPendingMessages(userId)
                .flatMap(sessionId -> pushPendingMessagesForSession(userId, sessionId)
                        .doOnNext(delivered -> {
                            if (delivered > 0) {
                                sessionCount.incrementAndGet();
                                messageCount.addAndGet(delivered);
                            }
                        }), concurrency)
                .then()
                .subscribe(
                        v -> {},
                        error -> log.error(
                                "Error during server-push sync fan-out for user {}: {}",
                                userId, error.getMessage()),
                        () -> {
                            int sessions = sessionCount.get();
                            int messages = messageCount.get();
                            if (sessions > 0) {
                                log.info(
                                        "Server-push sync: userId={}, sessions={}, messages={}",
                                        userId, sessions, messages);
                            } else {
                                log.debug(
                                        "Server-push sync: userId={}, no pending messages",
                                        userId);
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
     * @param userId    the recipient's Telegram user ID
     * @param sessionId the session whose queue should be drained
     * @return mono of the number of messages delivered (0 if none)
     */
    private Mono<Integer> pushPendingMessagesForSession(Long userId, String sessionId) {
        return messageRepository.getPendingMessages(userId, sessionId)
                .collectList()
                .flatMap(messages -> {
                    if (messages.isEmpty()) {
                        return Mono.just(0);
                    }

                    List<SyncedMessage> syncedMessages = messages.stream()
                            .map(SyncedMessage::fromMessage)
                            .toList();

                    SyncMessagesEvent event = SyncMessagesEvent.success(sessionId, syncedMessages);

                    // convertAndSendToUser is synchronous w.r.t. broker hand-off —
                    // only then clear the Redis queue so that a crash before
                    // hand-off preserves the messages for the next sync attempt.
                    messagingTemplate.convertAndSendToUser(
                            String.valueOf(userId),
                            SYNC_MESSAGES_DESTINATION,
                            event
                    );

                    log.debug("Server-push sync: delivered {} messages to user {} for session {}",
                            messages.size(), userId, sessionId);

                    return messageRepository.deleteMessages(userId, sessionId)
                            .thenReturn(messages.size());
                })
                .onErrorResume(error -> {
                    log.error("Server-push sync failed for user {} session {}: {}",
                            userId, sessionId, error.getMessage());
                    return Mono.just(0);
                });
    }
}

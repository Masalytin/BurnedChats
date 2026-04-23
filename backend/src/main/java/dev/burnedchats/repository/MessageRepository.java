package dev.burnedchats.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.config.MessagesProperties;
import dev.burnedchats.metrics.OfflineQueueMetrics;
import dev.burnedchats.metrics.OfflineSessionType;
import dev.burnedchats.model.DmMessageEditableMeta;
import dev.burnedchats.model.Message;
import dev.burnedchats.model.MessageEdit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * Redis repository for offline message queue.
 *
 * <p>Stores encrypted messages for users who are offline at the time
 * of message delivery. Messages are queued per-user per-session and
 * delivered when the user comes back online.
 *
 * <p>Key patterns:
 * <ul>
 *   <li>{@code messages:{recipientId}:{sessionId}} - List of pending messages</li>
 *   <li>{@code messages:count:{recipientId}} - Total pending message count for user</li>
 * </ul>
 *
 * <p>TTL and max list size: {@code burnedchats.messages.offline-queue} (default 24h, cap 100);
 * must not exceed the active session TTL (see {@code session.active.ttl}).
 *
 * <p>Security notes:
 * <ul>
 *   <li>Messages are stored encrypted - server cannot read content</li>
 *   <li>Messages are deleted immediately after delivery</li>
 *   <li>Messages expire automatically after TTL</li>
 *   <li>All messages for a session are deleted on session burn</li>
 * </ul>
 *
 * @see Message
 */
@Repository
public class MessageRepository {

    private static final Logger LOG = LoggerFactory.getLogger(MessageRepository.class);

    private static final String KEY_PREFIX = "messages:";
    private static final String COUNT_PREFIX = "messages:count:";
    private static final String EDIT_QUEUE_PREFIX = "message-edits:";
    private static final String EDITABLE_META_PREFIX = "dm-editable:";

    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final ObjectMapper objectMapper;
    private final MessagesProperties messagesProperties;
    private final OfflineQueueMetrics offlineQueueMetrics;

    public MessageRepository(
            ReactiveRedisTemplate<String, String> redisTemplate,
            ObjectMapper objectMapper,
            MessagesProperties messagesProperties,
            OfflineQueueMetrics offlineQueueMetrics) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
        this.messagesProperties = messagesProperties;
        this.offlineQueueMetrics = offlineQueueMetrics;
    }

    /**
     * Queue a message for offline delivery.
     *
     * <p>The message is added to a per-session queue for the recipient.
     * If the queue exceeds the configured max size, oldest messages
     * are dropped.
     *
     * @param message the message to queue
     * @return true if message was queued successfully
     */
    public Mono<Boolean> queueMessage(Message message) {
        int maxList = messagesProperties.getOfflineQueue().getMaxSizePerSession();
        Duration listTtl = messagesProperties.getOfflineQueue().getTtl();
        String key = keyFor(message.getRecipientId(), message.getSessionId());
        String countKey = countKeyFor(message.getRecipientId());

        return serializeMessage(message)
                .flatMap(json -> {
                    // Add to list and enforce max size
                    return redisTemplate.opsForList()
                            .rightPush(key, json)
                            .flatMap(size -> {
                                if (size > maxList) {
                                    long dropped = size - maxList;
                                    offlineQueueMetrics.recordDroppedOverflow(OfflineSessionType.dm, dropped);
                                    return redisTemplate.opsForList()
                                            .trim(key, -maxList, -1L)
                                            .thenReturn((long) maxList);
                                }
                                return Mono.just(size);
                            })
                            .flatMap(size -> {
                                offlineQueueMetrics.setTrackedListSize(key, size);
                                // Set TTL on first message
                                if (size == 1) {
                                    return redisTemplate.expire(key, listTtl)
                                            .thenReturn(true);
                                }
                                return Mono.just(true);
                            })
                            .flatMap(result -> {
                                // Increment total count
                                return redisTemplate.opsForValue()
                                        .increment(countKey)
                                        .flatMap(count -> {
                                            if (count == 1) {
                                                return redisTemplate.expire(countKey, listTtl)
                                                        .thenReturn(true);
                                            }
                                            return Mono.just(true);
                                        });
                            });
                })
                .doOnSuccess(ok -> {
                    if (Boolean.TRUE.equals(ok)) {
                        offlineQueueMetrics.recordEnqueued(OfflineSessionType.dm);
                        LOG.debug("Queued message {} for user {} in session {}",
                                message.getMessageId(), message.getRecipientId(), message.getSessionId());
                    }
                })
                .onErrorResume(e -> {
                    LOG.error("Failed to queue message: {}", e.getMessage());
                    return Mono.just(false);
                });
    }

    /**
     * Get all pending messages for a user in a session.
     *
     * @param recipientId the recipient's Telegram user ID
     * @param sessionId   the session ID
     * @return flux of pending messages
     */
    public Flux<Message> getPendingMessages(Long recipientId, String sessionId) {
        String key = keyFor(recipientId, sessionId);

        return redisTemplate.opsForList()
                .range(key, 0, -1)
                .flatMap(this::deserializeMessage)
                .doOnComplete(() -> LOG.debug("Retrieved pending messages for user {} in session {}",
                        recipientId, sessionId));
    }

    /**
     * Get all pending messages for a user across all sessions.
     *
     * @param recipientId the recipient's Telegram user ID
     * @return flux of pending messages
     */
    public Flux<Message> getAllPendingMessages(Long recipientId) {
        String pattern = KEY_PREFIX + recipientId + ":*";

        return redisTemplate.keys(pattern)
                .flatMap(key -> redisTemplate.opsForList()
                        .range(key, 0, -1)
                        .flatMap(this::deserializeMessage))
                .doOnComplete(() -> LOG.debug("Retrieved all pending messages for user {}", recipientId));
    }

    /**
     * Find all session IDs that have at least one pending message for the given user.
     *
     * <p>Uses a Redis {@code SCAN} over keys matching
     * {@code messages:{userId}:*} and extracts the session-ID suffix.
     * Duplicates that may arise from {@code SCAN} cursor semantics are
     * de-duplicated via {@link Flux#distinct()}.
     *
     * <p>This method is used by {@code WebSocketEventListener} to drive
     * server-initiated sync fan-out on STOMP CONNECT.
     *
     * @param userId the recipient's Telegram user ID
     * @return flux of session IDs (distinct), empty if no pending messages
     */
    public Flux<String> findSessionsWithPendingMessages(Long userId) {
        String match = KEY_PREFIX + userId + ":*";
        String keyPrefix = KEY_PREFIX + userId + ":";

        ScanOptions options = ScanOptions.scanOptions()
                .match(match)
                .count(100)
                .build();

        return redisTemplate.scan(options)
                .map(key -> key.substring(keyPrefix.length()))
                .distinct()
                .doOnComplete(() -> LOG.debug(
                        "Scanned sessions with pending messages for user {}", userId));
    }

    /**
     * Delete all pending messages for a user in a session.
     *
     * <p>Called after messages are delivered or session is burned.
     *
     * @param recipientId the recipient's Telegram user ID
     * @param sessionId   the session ID
     * @return number of messages deleted
     */
    public Mono<Long> deleteMessages(Long recipientId, String sessionId) {
        String key = keyFor(recipientId, sessionId);
        String countKey = countKeyFor(recipientId);
        offlineQueueMetrics.removeTrackedListKey(key);

        return redisTemplate.opsForList()
                .size(key)
                .flatMap(count -> redisTemplate.delete(key)
                        .flatMap(deleted -> {
                            if (deleted > 0 && count > 0) {
                                // Decrement total count
                                return redisTemplate.opsForValue()
                                        .decrement(countKey, count)
                                        .thenReturn(count);
                            }
                            return Mono.just(count);
                        }))
                .doOnSuccess(count -> LOG.debug("Deleted {} messages for user {} in session {}",
                        count, recipientId, sessionId));
    }

    /**
     * Delete all pending messages for a session (both participants).
     *
     * <p>Called when a session is burned.
     *
     * @param sessionId     the session ID
     * @param participantIds the participant user IDs
     * @return total number of messages deleted
     */
    public Mono<Long> deleteAllForSession(String sessionId, List<Long> participantIds) {
        return Flux.fromIterable(participantIds)
                .flatMap(userId -> deleteMessages(userId, sessionId)
                        .flatMap(dmCount -> deleteEdits(userId, sessionId)
                                .defaultIfEmpty(0L)
                                .map(edCount -> dmCount + edCount)))
                .reduce(0L, Long::sum)
                .flatMap(total -> deleteAllEditableMetaForSession(sessionId)
                        .map(metaDeleted -> total + metaDeleted))
                .doOnSuccess(count -> LOG.debug("Deleted {} total keys for session {}", count, sessionId));
    }

    /**
     * Remember who sent a DM message and when, for edit validation after the message
     * left the offline queue. Short TTL.
     */
    public Mono<Boolean> putDmMessageEditableMeta(
            String sessionId, String messageId, Long senderId, Instant serverTimestamp) {
        String key = editableMetaKey(sessionId, messageId);
        Duration ttl = messagesProperties.getMessageEdits().getEditableMetaTtl();
        DmMessageEditableMeta meta = DmMessageEditableMeta.builder()
                .senderId(senderId)
                .serverTimestamp(serverTimestamp)
                .build();
        return serializeEditableMeta(meta)
                .flatMap(json -> redisTemplate.opsForValue()
                        .set(key, json)
                        .flatMap(ok -> Boolean.TRUE.equals(ok)
                                ? redisTemplate.expire(key, ttl).thenReturn(true)
                                : Mono.just(false)))
                .onErrorResume(e -> {
                    LOG.warn("putDmMessageEditableMeta failed: {}", e.getMessage());
                    return Mono.just(false);
                });
    }

    /**
     * Look up edit validation metadata for a delivered DM message.
     */
    public Mono<DmMessageEditableMeta> getDmMessageEditableMeta(String sessionId, String messageId) {
        String key = editableMetaKey(sessionId, messageId);
        return redisTemplate.opsForValue()
                .get(key)
                .flatMap(this::deserializeEditableMeta);
    }

    /**
     * Remove all {@code dm-editable:{sessionId}:*} keys (session burn).
     */
    public Mono<Long> deleteAllEditableMetaForSession(String sessionId) {
        String match = EDITABLE_META_PREFIX + sessionId + ":*";
        ScanOptions options = ScanOptions.scanOptions().match(match).count(100).build();
        return redisTemplate.scan(options)
                .flatMap(redisTemplate::delete)
                .reduce(0L, Long::sum)
                .defaultIfEmpty(0L);
    }

    /**
     * Update a pending offline message in-place (same messageId, new ciphertext).
     *
     * @return true if an entry was updated
     */
    @SuppressWarnings("checkstyle:BooleanExpressionComplexity")
    public Mono<Boolean> updateMessageInQueue(
            Long recipientId,
            String sessionId,
            String messageId,
            Long senderId,
            String newEncryptedContent,
            String newIv,
            Instant editedAt) {
        String key = keyFor(recipientId, sessionId);
        return redisTemplate.opsForList()
                .range(key, 0, -1)
                .collectList()
                .flatMap(jsonList -> {
                    if (jsonList.isEmpty()) {
                        return Mono.just(false);
                    }
                    int index = -1;
                    Message target = null;
                    for (int i = 0; i < jsonList.size(); i++) {
                        try {
                            Message m = objectMapper.readValue(jsonList.get(i), Message.class);
                            if (messageId.equals(m.getMessageId())) {
                                index = i;
                                target = m;
                                break;
                            }
                        } catch (JsonProcessingException e) {
                            LOG.warn("Skipping bad queue entry: {}", e.getMessage());
                        }
                    }
                    if (index < 0 || target == null) {
                        return Mono.just(false);
                    }
                    if (!senderId.equals(target.getSenderId())) {
                        return Mono.just(false);
                    }
                    if (isOutsideEditWindow(target.getServerTimestamp())) {
                        return Mono.just(false);
                    }
                    Message.MessageBuilder b = target.toBuilder()
                            .encryptedContent(newEncryptedContent)
                            .iv(newIv)
                            .editedAt(editedAt);
                    Message updated = b.build();
                    int finalIndex = index;
                    return serializeMessage(updated)
                            .flatMap(json -> redisTemplate.opsForList().set(key, finalIndex, json))
                            .thenReturn(true);
                })
                .defaultIfEmpty(false)
                .onErrorResume(e -> {
                    LOG.error("updateMessageInQueue failed: {}", e.getMessage());
                    return Mono.just(false);
                });
    }

    /**
     * Queue an edit for later delivery (recipient was offline and message not in main list).
     */
    public Mono<Boolean> queueEdit(Long recipientId, String sessionId, MessageEdit edit) {
        int maxList = messagesProperties.getMessageEdits().getMaxSize();
        Duration listTtl = messagesProperties.getMessageEdits().getTtl();
        String key = editsKeyFor(recipientId, sessionId);

        return serializeMessageEdit(edit)
                .flatMap(json -> redisTemplate.opsForList()
                        .rightPush(key, json)
                        .flatMap(size -> {
                            if (size > maxList) {
                                long dropped = size - maxList;
                                offlineQueueMetrics.recordDroppedOverflow(OfflineSessionType.dm, dropped);
                                return redisTemplate.opsForList()
                                        .trim(key, -maxList, -1L)
                                        .thenReturn((long) maxList);
                            }
                            return Mono.just(size);
                        })
                        .flatMap(size -> {
                            if (size == 1) {
                                return redisTemplate.expire(key, listTtl).thenReturn(true);
                            }
                            return redisTemplate.expire(key, listTtl).thenReturn(true);
                        }))
                .doOnSuccess(ok -> {
                    if (Boolean.TRUE.equals(ok)) {
                        LOG.debug("Queued edit for message {} session {} recipient {}",
                                edit.getMessageId(), sessionId, recipientId);
                    }
                })
                .onErrorResume(e -> {
                    LOG.error("queueEdit failed: {}", e.getMessage());
                    return Mono.just(false);
                });
    }

    /**
     * Drain pending tombstone edits for a session.
     */
    public Flux<MessageEdit> getPendingEdits(Long recipientId, String sessionId) {
        String key = editsKeyFor(recipientId, sessionId);
        return redisTemplate.opsForList()
                .range(key, 0, -1)
                .flatMap(this::deserializeMessageEdit);
    }

    /**
     * Delete all pending tombstone edits after delivery.
     */
    public Mono<Long> deleteEdits(Long recipientId, String sessionId) {
        String key = editsKeyFor(recipientId, sessionId);
        return redisTemplate.delete(key);
    }

    /**
     * Find session IDs that have at least one pending tombstone edit for the user.
     */
    public Flux<String> findSessionsWithPendingEdits(Long userId) {
        String match = EDIT_QUEUE_PREFIX + userId + ":*";
        String keyPrefix = EDIT_QUEUE_PREFIX + userId + ":";
        ScanOptions options = ScanOptions.scanOptions().match(match).count(100).build();
        return redisTemplate.scan(options)
                .map(k -> k.substring(keyPrefix.length()))
                .distinct();
    }

    private static boolean isOutsideEditWindow(Instant serverTimestamp) {
        if (serverTimestamp == null) {
            return true;
        }
        return serverTimestamp.plus(15, ChronoUnit.MINUTES).isBefore(Instant.now());
    }

    private String editableMetaKey(String sessionId, String messageId) {
        return EDITABLE_META_PREFIX + sessionId + ":" + messageId;
    }

    private String editsKeyFor(Long recipientId, String sessionId) {
        return EDIT_QUEUE_PREFIX + recipientId + ":" + sessionId;
    }

    private Mono<String> serializeEditableMeta(DmMessageEditableMeta meta) {
        return Mono.fromCallable(() -> objectMapper.writeValueAsString(meta))
                .onErrorMap(JsonProcessingException.class, e ->
                        new RuntimeException("Failed to serialize editable meta", e));
    }

    private Mono<DmMessageEditableMeta> deserializeEditableMeta(String json) {
        return Mono.fromCallable(() -> objectMapper.readValue(json, DmMessageEditableMeta.class))
                .onErrorResume(e -> {
                    LOG.warn("deserializeEditableMeta: {}", e.getMessage());
                    return Mono.empty();
                });
    }

    private Mono<String> serializeMessageEdit(MessageEdit edit) {
        return Mono.fromCallable(() -> objectMapper.writeValueAsString(edit))
                .onErrorMap(JsonProcessingException.class, e ->
                        new RuntimeException("Failed to serialize message edit", e));
    }

    private Mono<MessageEdit> deserializeMessageEdit(String json) {
        return Mono.fromCallable(() -> objectMapper.readValue(json, MessageEdit.class))
                .onErrorResume(e -> {
                    LOG.warn("Failed to deserialize message edit: {}", e.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * Get count of pending messages for a user.
     *
     * @param recipientId the recipient's Telegram user ID
     * @return count of pending messages
     */
    public Mono<Long> getPendingCount(Long recipientId) {
        String countKey = countKeyFor(recipientId);

        return redisTemplate.opsForValue()
                .get(countKey)
                .map(Long::parseLong)
                .defaultIfEmpty(0L);
    }

    /**
     * Check if a message ID already exists (for deduplication).
     *
     * <p>Note: This is a simple check by scanning the queue.
     * For high-volume scenarios, consider a separate dedup index.
     *
     * @param recipientId the recipient's Telegram user ID
     * @param sessionId   the session ID
     * @param messageId   the message ID to check
     * @return true if message already exists
     */
    public Mono<Boolean> messageExists(Long recipientId, String sessionId, String messageId) {
        return getPendingMessages(recipientId, sessionId)
                .any(msg -> messageId.equals(msg.getMessageId()));
    }

    private String keyFor(Long recipientId, String sessionId) {
        return KEY_PREFIX + recipientId + ":" + sessionId;
    }

    private String countKeyFor(Long recipientId) {
        return COUNT_PREFIX + recipientId;
    }

    private Mono<String> serializeMessage(Message message) {
        return Mono.fromCallable(() -> objectMapper.writeValueAsString(message))
                .onErrorMap(JsonProcessingException.class, e ->
                        new RuntimeException("Failed to serialize message", e));
    }

    private Mono<Message> deserializeMessage(String json) {
        return Mono.fromCallable(() -> objectMapper.readValue(json, Message.class))
                .onErrorResume(e -> {
                    LOG.warn("Failed to deserialize message: {}", e.getMessage());
                    return Mono.empty();
                });
    }
}

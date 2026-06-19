package dev.burnedchats.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.config.MessagesProperties;
import dev.burnedchats.metrics.OfflineQueueMetrics;
import dev.burnedchats.metrics.OfflineSessionType;
import dev.burnedchats.model.DmMessageEditableMeta;
import dev.burnedchats.model.Message;
import dev.burnedchats.model.MessageDeletion;
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
import java.util.Optional;

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
@SuppressWarnings({"checkstyle:OverloadMethodsDeclarationOrder", "checkstyle:EmptyLineSeparator"})
public class MessageRepository {

    private static final Logger LOG = LoggerFactory.getLogger(MessageRepository.class);

    private static final String KEY_PREFIX = "messages:";
    private static final String COUNT_PREFIX = "messages:count:";
    private static final String EDIT_QUEUE_PREFIX = "message-edits:";
    private static final String EDITABLE_META_PREFIX = "dm-editable:";
    private static final String SENDER_INDEX_PREFIX = "message-senders:";
    private static final String DELETION_QUEUE_PREFIX = "message-deletions:";

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
        String recipientInternalId = message.getRecipientInternalId() != null
                ? message.getRecipientInternalId()
                : String.valueOf(message.getRecipientId());
        String key = keyFor(recipientInternalId, message.getSessionId());
        String countKey = countKeyFor(recipientInternalId);

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
                                return redisTemplate.expire(key, listTtl).thenReturn(true);
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
    public Flux<Message> getPendingMessages(String recipientId, String sessionId) {
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
    public Flux<Message> getAllPendingMessages(String recipientId) {
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
    public Flux<String> findSessionsWithPendingMessages(String userId) {
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
    public Mono<Long> deleteMessages(String recipientId, String sessionId) {
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
    public Mono<Long> deleteAllForSession(String sessionId, List<?> participantIds) {
        return Flux.fromIterable(participantIds)
                .map(this::toInternalId)
                .flatMap(userId -> deleteMessages(userId, sessionId)
                        .flatMap(dmCount -> deleteEdits(userId, sessionId)
                                .defaultIfEmpty(0L)
                                .flatMap(edCount -> deleteDeletions(userId, sessionId)
                                        .map(delCount -> dmCount + edCount + delCount))))
                .reduce(0L, Long::sum)
                .flatMap(total -> deleteAllEditableMetaForSession(sessionId)
                        .flatMap(metaDeleted -> deleteMessageSenderIndexForSession(sessionId)
                                .map(idxDeleted -> total + metaDeleted + idxDeleted)))
                .doOnSuccess(count -> LOG.debug("Deleted {} total keys for session {}", count, sessionId));
    }


    /**
     * Remember who sent a DM message and when, for edit validation after the message
     * left the offline queue. Short TTL.
     */
    public Mono<Boolean> putDmMessageEditableMeta(
            String sessionId,
            String messageId,
            String senderInternalId,
            Long senderId,
            Instant serverTimestamp,
            String fileId,
            String thumbnailFileId) {
        String key = editableMetaKey(sessionId, messageId);
        Duration ttl = messagesProperties.getMessageEdits().getEditableMetaTtl();
        DmMessageEditableMeta.DmMessageEditableMetaBuilder b = DmMessageEditableMeta.builder()
                .senderInternalId(senderInternalId)
                .senderId(senderId)
                .serverTimestamp(serverTimestamp);
        if (fileId != null && !fileId.isBlank()) {
            b.fileId(fileId);
        }
        if (thumbnailFileId != null && !thumbnailFileId.isBlank()) {
            b.thumbnailFileId(thumbnailFileId);
        }
        DmMessageEditableMeta meta = b.build();
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
     * Remove editable meta for a single message (after delete for everyone).
     */
    public Mono<Boolean> deleteDmMessageEditableMeta(String sessionId, String messageId) {
        String key = editableMetaKey(sessionId, messageId);
        return redisTemplate.delete(key)
                .map(n -> n > 0);
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
            String recipientId,
            String sessionId,
            String messageId,
            String senderInternalId,
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
                    if (!isSenderForEdit(target, senderInternalId, senderId)) {
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

    private static boolean isSenderForEdit(Message target, String senderInternalId, Long senderId) {
        if (senderInternalId != null && !senderInternalId.isBlank()
                && target.getSenderInternalId() != null) {
            return senderInternalId.equals(target.getSenderInternalId());
        }
        if (senderId != null && senderId != 0 && target.getSenderId() != null) {
            return senderId.equals(target.getSenderId());
        }
        return false;
    }

    public Mono<Boolean> updateMessageInQueue(
            String recipientId,
            String sessionId,
            String messageId,
            Long senderId,
            String newEncryptedContent,
            String newIv,
            Instant editedAt) {
        return updateMessageInQueue(
                recipientId,
                sessionId,
                messageId,
                null,
                senderId,
                newEncryptedContent,
                newIv,
                editedAt);
    }

    public Mono<Boolean> updateMessageInQueue(
            Long recipientId,
            String sessionId,
            String messageId,
            Long senderId,
            String newEncryptedContent,
            String newIv,
            Instant editedAt) {
        return updateMessageInQueue(
                String.valueOf(recipientId),
                sessionId,
                messageId,
                senderId,
                newEncryptedContent,
                newIv,
                editedAt);
    }

    /**
     * Queue an edit for later delivery (recipient was offline and message not in main list).
     */
    public Mono<Boolean> queueEdit(String recipientId, String sessionId, MessageEdit edit) {
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
    public Flux<MessageEdit> getPendingEdits(String recipientId, String sessionId) {
        String key = editsKeyFor(recipientId, sessionId);
        return redisTemplate.opsForList()
                .range(key, 0, -1)
                .flatMap(this::deserializeMessageEdit);
    }

    /**
     * Delete all pending tombstone edits after delivery.
     */
    public Mono<Long> deleteEdits(String recipientId, String sessionId) {
        String key = editsKeyFor(recipientId, sessionId);
        return redisTemplate.delete(key);
    }

    /**
     * Find session IDs that have at least one pending tombstone edit for the user.
     */
    public Flux<String> findSessionsWithPendingEdits(String userId) {
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

    /**
     * Store messageId → sender for delivered/queued DM messages (short TTL).
     */
    public Mono<Boolean> putMessageSenderIndex(String sessionId, String messageId, Long senderTgId) {
        String key = senderIndexKey(sessionId);
        Duration ttl = messagesProperties.getSenderIndexTtl();
        return redisTemplate.opsForHash()
                .put(key, messageId, String.valueOf(senderTgId))
                .flatMap(ok -> redisTemplate.expire(key, ttl).thenReturn(Boolean.TRUE.equals(ok)))
                .onErrorResume(e -> {
                    LOG.warn("putMessageSenderIndex failed: {}", e.getMessage());
                    return Mono.just(false);
                });
    }

    public Mono<Long> getMessageSenderIndex(String sessionId, String messageId) {
        String key = senderIndexKey(sessionId);
        return redisTemplate.opsForHash()
                .get(key, messageId)
                .map(v -> Long.parseLong(String.valueOf(v)));
    }

    public Mono<Long> removeMessageSenderIndex(String sessionId, String messageId) {
        String key = senderIndexKey(sessionId);
        return redisTemplate.opsForHash()
                .remove(key, messageId);
    }

    public Mono<Long> deleteMessageSenderIndexForSession(String sessionId) {
        return redisTemplate.delete(senderIndexKey(sessionId));
    }

    /**
     * Remove one message from the recipient's offline queue; returns the removed payload if any.
     */
    public Mono<Optional<Message>> removeMessageFromQueue(String recipientId, String sessionId, String messageId) {
        String key = keyFor(recipientId, sessionId);
        return redisTemplate.opsForList()
                .range(key, 0, -1)
                .collectList()
                .flatMap(jsonList -> {
                    for (String json : jsonList) {
                        try {
                            Message m = objectMapper.readValue(json, Message.class);
                            if (messageId.equals(m.getMessageId())) {
                                return redisTemplate.opsForList()
                                        .remove(key, 1L, json)
                                        .then(updateCountAfterRemove(recipientId, key, jsonList.size() - 1))
                                        .thenReturn(Optional.of(m));
                            }
                        } catch (JsonProcessingException e) {
                            LOG.warn("Skipping bad queue entry: {}", e.getMessage());
                        }
                    }
                    return Mono.just(Optional.empty());
                });
    }

    private Mono<Void> updateCountAfterRemove(String recipientId, String queueKey, long newSize) {
        String countKey = countKeyFor(recipientId);
        if (newSize <= 0) {
            offlineQueueMetrics.removeTrackedListKey(queueKey);
            return redisTemplate.delete(queueKey)
                    .flatMap(deleted -> deleted > 0
                            ? redisTemplate.opsForValue().decrement(countKey)
                            : Mono.empty())
                    .then();
        }
        offlineQueueMetrics.setTrackedListSize(queueKey, newSize);
        return redisTemplate.opsForValue().decrement(countKey).then();
    }

    public Mono<Boolean> queueDeletion(String recipientId, String sessionId, MessageDeletion deletion) {
        int maxList = messagesProperties.getMessageDeletions().getMaxSize();
        Duration listTtl = messagesProperties.getMessageDeletions().getTtl();
        String key = deletionsKeyFor(recipientId, sessionId);
        return serializeMessageDeletion(deletion)
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
                .onErrorResume(e -> {
                    LOG.error("queueDeletion failed: {}", e.getMessage());
                    return Mono.just(false);
                });
    }

    public Flux<MessageDeletion> getPendingDeletions(String recipientId, String sessionId) {
        String key = deletionsKeyFor(recipientId, sessionId);
        return redisTemplate.opsForList()
                .range(key, 0, -1)
                .flatMap(this::deserializeMessageDeletion);
    }

    public Mono<Long> deleteDeletions(String recipientId, String sessionId) {
        String key = deletionsKeyFor(recipientId, sessionId);
        return redisTemplate.delete(key);
    }

    public Flux<String> findSessionsWithPendingDeletions(String userId) {
        String match = DELETION_QUEUE_PREFIX + userId + ":*";
        String keyPrefix = DELETION_QUEUE_PREFIX + userId + ":";
        ScanOptions options = ScanOptions.scanOptions().match(match).count(100).build();
        return redisTemplate.scan(options)
                .map(k -> k.substring(keyPrefix.length()))
                .distinct();
    }

    public Flux<Message> getPendingMessages(Long recipientId, String sessionId) {
        return getPendingMessages(String.valueOf(recipientId), sessionId);
    }

    public Flux<String> findSessionsWithPendingMessages(Long userId) {
        return findSessionsWithPendingMessages(String.valueOf(userId));
    }

    public Mono<Long> deleteMessages(Long recipientId, String sessionId) {
        return deleteMessages(String.valueOf(recipientId), sessionId);
    }

    public Mono<Boolean> queueEdit(Long recipientId, String sessionId, MessageEdit edit) {
        return queueEdit(String.valueOf(recipientId), sessionId, edit);
    }

    public Flux<MessageEdit> getPendingEdits(Long recipientId, String sessionId) {
        return getPendingEdits(String.valueOf(recipientId), sessionId);
    }

    public Mono<Long> deleteEdits(Long recipientId, String sessionId) {
        return deleteEdits(String.valueOf(recipientId), sessionId);
    }

    public Flux<String> findSessionsWithPendingEdits(Long userId) {
        return findSessionsWithPendingEdits(String.valueOf(userId));
    }

    public Mono<Optional<Message>> removeMessageFromQueue(Long recipientId, String sessionId, String messageId) {
        return removeMessageFromQueue(String.valueOf(recipientId), sessionId, messageId);
    }

    public Mono<Boolean> queueDeletion(Long recipientId, String sessionId, MessageDeletion deletion) {
        return queueDeletion(String.valueOf(recipientId), sessionId, deletion);
    }

    public Flux<MessageDeletion> getPendingDeletions(Long recipientId, String sessionId) {
        return getPendingDeletions(String.valueOf(recipientId), sessionId);
    }

    public Mono<Long> deleteDeletions(Long recipientId, String sessionId) {
        return deleteDeletions(String.valueOf(recipientId), sessionId);
    }

    public Flux<String> findSessionsWithPendingDeletions(Long userId) {
        return findSessionsWithPendingDeletions(String.valueOf(userId));
    }

    public Flux<Message> getAllPendingMessages(Long recipientId) {
        return getAllPendingMessages(String.valueOf(recipientId));
    }

    public Mono<Long> getPendingCount(Long recipientId) {
        return getPendingCount(String.valueOf(recipientId));
    }

    public Mono<Boolean> messageExists(Long recipientId, String sessionId, String messageId) {
        return messageExists(String.valueOf(recipientId), sessionId, messageId);
    }

    private String senderIndexKey(String sessionId) {
        return SENDER_INDEX_PREFIX + sessionId;
    }

    private String deletionsKeyFor(String recipientId, String sessionId) {
        return DELETION_QUEUE_PREFIX + recipientId + ":" + sessionId;
    }

    private Mono<String> serializeMessageDeletion(MessageDeletion deletion) {
        return Mono.fromCallable(() -> objectMapper.writeValueAsString(deletion))
                .onErrorMap(JsonProcessingException.class, e ->
                        new RuntimeException("Failed to serialize message deletion", e));
    }

    private Mono<MessageDeletion> deserializeMessageDeletion(String json) {
        return Mono.fromCallable(() -> objectMapper.readValue(json, MessageDeletion.class))
                .onErrorResume(e -> {
                    LOG.warn("Failed to deserialize message deletion: {}", e.getMessage());
                    return Mono.empty();
                });
    }

    private String editableMetaKey(String sessionId, String messageId) {
        return EDITABLE_META_PREFIX + sessionId + ":" + messageId;
    }

    private String editsKeyFor(String recipientId, String sessionId) {
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
    public Mono<Long> getPendingCount(String recipientId) {
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
    public Mono<Boolean> messageExists(String recipientId, String sessionId, String messageId) {
        return getPendingMessages(recipientId, sessionId)
                .any(msg -> messageId.equals(msg.getMessageId()));
    }

    private String keyFor(String recipientId, String sessionId) {
        return KEY_PREFIX + recipientId + ":" + sessionId;
    }

    private String toInternalId(Object value) {
        if (value instanceof Long l) {
            return String.valueOf(l);
        }
        return String.valueOf(value);
    }

    private String countKeyFor(String recipientId) {
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

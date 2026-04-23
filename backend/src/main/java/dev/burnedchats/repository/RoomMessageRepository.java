package dev.burnedchats.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.config.MessagesProperties;
import dev.burnedchats.metrics.OfflineQueueMetrics;
import dev.burnedchats.metrics.OfflineSessionType;
import dev.burnedchats.model.RoomMessage;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;

/**
 * Redis repository for room message storage.
 *
 * <p>Stores encrypted group messages per room as a shared list.
 * Messages are available to all room members for offline delivery (sync).
 * Unlike private chat messages, room messages are not deleted after delivery —
 * they expire after TTL so late-connecting members can still retrieve them.
 *
 * <p>Key patterns:
 * <ul>
 *   <li>{@code messages:{roomId}} — List of recent room messages, TTL 24 hours</li>
 * </ul>
 *
 * <p>Security notes:
 * <ul>
 *   <li>All stored content is E2EE-encrypted with the room's group key</li>
 *   <li>Server never has access to the decryption key</li>
 *   <li>Messages auto-expire after TTL — no persistent storage</li>
 * </ul>
 *
 * @see RoomMessage
 */
@Slf4j
@Repository
public class RoomMessageRepository {

    private static final String KEY_PREFIX = "messages:";

    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final ObjectMapper objectMapper;
    private final MessagesProperties messagesProperties;
    private final OfflineQueueMetrics offlineQueueMetrics;

    public RoomMessageRepository(
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
     * Save a new room message to the room's message list.
     *
     * <p>Pushes the message to the end of the list. Trims the list
     * if it exceeds MAX_MESSAGES_PER_ROOM (dropping oldest messages).
     * Refreshes the TTL on every write.
     *
     * @param message the room message to save
     * @return true if saved successfully
     */
    public Mono<Boolean> saveMessage(RoomMessage message) {
        int maxRoom = messagesProperties.getOfflineQueue().getMaxSizePerRoom();
        Duration ttl = messagesProperties.getOfflineQueue().getTtl();
        String key = keyFor(message.getRoomId());

        return serializeMessage(message)
                .flatMap(json -> redisTemplate.opsForList()
                        .rightPush(key, json)
                        .flatMap(size -> {
                            if (size > maxRoom) {
                                long dropped = size - maxRoom;
                                offlineQueueMetrics.recordDroppedOverflow(OfflineSessionType.room, dropped);
                                return redisTemplate.opsForList()
                                        .trim(key, -maxRoom, -1)
                                        .thenReturn((long) maxRoom);
                            }
                            return Mono.just(size);
                        })
                        .flatMap(size -> {
                            offlineQueueMetrics.setTrackedListSize(key, size);
                            return redisTemplate.expire(key, ttl).thenReturn(true);
                        })
                )
                .doOnSuccess(r -> {
                    if (Boolean.TRUE.equals(r)) {
                        offlineQueueMetrics.recordEnqueued(OfflineSessionType.room);
                        LOG.debug("Saved room message {} for room {}",
                                message.getMessageId(), message.getRoomId());
                    }
                })
                .onErrorResume(e -> {
                    LOG.error("Failed to save room message: roomId={}, error={}",
                            message.getRoomId(), e.getMessage());
                    return Mono.just(false);
                });
    }

    /**
     * Retrieve all messages stored for a room (for SYNC_ROOM_MESSAGES).
     *
     * <p>Returns all messages currently in the room's list,
     * from oldest to newest.
     *
     * @param roomId the room UUID
     * @return flux of room messages
     */
    public Flux<RoomMessage> getRoomMessages(String roomId) {
        String key = keyFor(roomId);

        return redisTemplate.opsForList()
                .range(key, 0, -1)
                .flatMap(this::deserializeMessage)
                .doOnComplete(() -> LOG.debug("Retrieved messages for room {}", roomId));
    }

    /**
     * Delete all messages for a room (called on BURN_ROOM).
     *
     * @param roomId the room UUID
     * @return Mono with number of keys deleted
     */
    public Mono<Long> deleteRoomMessages(String roomId) {
        String key = keyFor(roomId);
        offlineQueueMetrics.removeTrackedListKey(key);

        return redisTemplate.delete(key)
                .doOnSuccess(n -> LOG.debug("Deleted message list for room {}: {} keys", roomId, n));
    }

    /**
     * Replace ciphertext for an existing room message (same id); attachment fields unchanged.
     */
    public Mono<RoomMessage> updateMessage(
            String roomId,
            String messageId,
            Long senderTgId,
            String newEncryptedContent,
            String newIv,
            Instant editedAt) {
        String key = keyFor(roomId);
        Duration ttl = messagesProperties.getOfflineQueue().getTtl();
        return redisTemplate.opsForList()
                .range(key, 0, -1)
                .collectList()
                .flatMap(jsonList -> {
                    if (jsonList.isEmpty()) {
                        return Mono.empty();
                    }
                    int index = -1;
                    RoomMessage target = null;
                    for (int i = 0; i < jsonList.size(); i++) {
                        try {
                            RoomMessage m = objectMapper.readValue(jsonList.get(i), RoomMessage.class);
                            if (messageId.equals(m.getMessageId())) {
                                index = i;
                                target = m;
                                break;
                            }
                        } catch (JsonProcessingException e) {
                            LOG.warn("Skipping bad room list entry: {}", e.getMessage());
                        }
                    }
                    if (index < 0 || target == null) {
                        return Mono.empty();
                    }
                    if (!senderTgId.equals(target.getSenderTgId())) {
                        return Mono.empty();
                    }
                    if (target.getServerTimestamp() == null
                            || target.getServerTimestamp().plus(15, ChronoUnit.MINUTES).isBefore(Instant.now())) {
                        return Mono.empty();
                    }
                    RoomMessage updated = target.toBuilder()
                            .encryptedContent(newEncryptedContent)
                            .iv(newIv)
                            .editedAt(editedAt)
                            .build();
                    int finalIndex = index;
                    return serializeMessage(updated)
                            .flatMap(json -> redisTemplate.opsForList().set(key, finalIndex, json)
                                    .flatMap(b -> {
                                        if (Boolean.TRUE.equals(b)) {
                                            return redisTemplate.expire(key, ttl).thenReturn(updated);
                                        }
                                        return Mono.empty();
                                    }));
                })
                .onErrorResume(e -> {
                    LOG.error("updateMessage failed: {}", e.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * Find a room message by id without mutating the list.
     */
    public Mono<Optional<RoomMessage>> findRoomMessageById(String roomId, String messageId) {
        String key = keyFor(roomId);
        return redisTemplate.opsForList()
                .range(key, 0, -1)
                .collectList()
                .flatMap(jsonList -> {
                    for (String json : jsonList) {
                        try {
                            RoomMessage m = objectMapper.readValue(json, RoomMessage.class);
                            if (messageId.equals(m.getMessageId())) {
                                return Mono.just(Optional.of(m));
                            }
                        } catch (JsonProcessingException e) {
                            LOG.warn("Skipping bad room list entry: {}", e.getMessage());
                        }
                    }
                    return Mono.just(Optional.empty());
                });
    }

    /**
     * Remove a known message value from the list (exact JSON for LREM).
     */
    public Mono<Boolean> removeRoomMessageValue(String roomId, RoomMessage message) {
        String key = keyFor(roomId);
        Duration ttl = messagesProperties.getOfflineQueue().getTtl();
        return serializeMessage(message)
                .flatMap(json -> redisTemplate.opsForList()
                        .remove(key, 1L, json)
                        .flatMap(removed -> {
                            if (removed != null && removed > 0) {
                                return redisTemplate.expire(key, ttl).thenReturn(true);
                            }
                            return Mono.just(false);
                        }))
                .onErrorResume(e -> {
                    LOG.error("removeRoomMessageValue failed: roomId={}, error={}", roomId, e.getMessage());
                    return Mono.just(false);
                });
    }

    private String keyFor(String roomId) {
        return KEY_PREFIX + roomId;
    }

    private Mono<String> serializeMessage(RoomMessage message) {
        return Mono.fromCallable(() -> objectMapper.writeValueAsString(message))
                .onErrorMap(JsonProcessingException.class, e ->
                        new RuntimeException("Failed to serialize room message", e));
    }

    private Mono<RoomMessage> deserializeMessage(String json) {
        return Mono.fromCallable(() -> objectMapper.readValue(json, RoomMessage.class))
                .onErrorResume(e -> {
                    LOG.warn("Failed to deserialize room message: {}", e.getMessage());
                    return Mono.empty();
                });
    }
}

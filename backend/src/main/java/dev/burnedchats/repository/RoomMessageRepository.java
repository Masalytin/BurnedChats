package dev.burnedchats.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.model.RoomMessage;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;

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

    /**
     * TTL for room message lists (24 hours).
     */
    static final Duration MESSAGE_TTL = Duration.ofHours(24);

    /**
     * Maximum messages stored per room to prevent unbounded growth.
     */
    private static final long MAX_MESSAGES_PER_ROOM = 500;

    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final ObjectMapper objectMapper;

    public RoomMessageRepository(ReactiveRedisTemplate<String, String> redisTemplate,
                                  ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
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
        String key = keyFor(message.getRoomId());

        return serializeMessage(message)
                .flatMap(json -> redisTemplate.opsForList()
                        .rightPush(key, json)
                        .flatMap(size -> {
                            if (size > MAX_MESSAGES_PER_ROOM) {
                                return redisTemplate.opsForList()
                                        .trim(key, -MAX_MESSAGES_PER_ROOM, -1)
                                        .thenReturn(size);
                            }
                            return Mono.just(size);
                        })
                        .flatMap(size -> redisTemplate.expire(key, MESSAGE_TTL)
                                .thenReturn(true))
                )
                .doOnSuccess(r -> log.debug("Saved room message {} for room {}",
                        message.getMessageId(), message.getRoomId()))
                .onErrorResume(e -> {
                    log.error("Failed to save room message: roomId={}, error={}",
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
                .doOnComplete(() -> log.debug("Retrieved messages for room {}", roomId));
    }

    /**
     * Delete all messages for a room (called on BURN_ROOM).
     *
     * @param roomId the room UUID
     * @return Mono with number of keys deleted
     */
    public Mono<Long> deleteRoomMessages(String roomId) {
        String key = keyFor(roomId);

        return redisTemplate.delete(key)
                .doOnSuccess(n -> log.debug("Deleted message list for room {}: {} keys", roomId, n));
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
                    log.warn("Failed to deserialize room message: {}", e.getMessage());
                    return Mono.empty();
                });
    }
}

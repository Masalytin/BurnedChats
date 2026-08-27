package dev.burnedchats.repository;

import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.Comparator;
import java.util.Map;

/**
 * Per-owner inbox of pending group-key requests (identifiers + timestamp only).
 *
 * <p>Key: {@code room_key_request_inbox:{ownerInternalId}} — Redis HASH, TTL 7 days.
 * Field {@code {roomId}:{requesterInternalId}} → {@code requestedAt} epoch millis.
 *
 * <p>HASH (not LIST) so a 12s client retry of the same pair updates one field
 * via {@code HSET} without reading the whole collection for dedup.
 *
 * <p>Zero-knowledge: no ciphertext, pubkey, or display names — only ids and time.
 * Fresh pubkey is read from {@code room_member_pubkey:{roomId}} at delivery.
 */
@Repository
public class RoomKeyRequestInboxRepository {

    private static final String PREFIX = "room_key_request_inbox:";
    static final Duration TTL = Duration.ofDays(7);

    /** Cap on HASH fields; overflow evicts the oldest {@code requestedAt}, not the newest. */
    static final int MAX_FIELDS = 100;

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    public RoomKeyRequestInboxRepository(ReactiveRedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * Store or refresh a key-request fact. Same pair overwrites the timestamp.
     *
     * @param ownerInternalId room owner who should wrap the group key
     * @param roomId room the requester belongs to
     * @param requesterInternalId member asking for a wrap
     * @param requestedAt epoch millis
     * @return completion signal
     */
    public Mono<Void> record(String ownerInternalId, String roomId, String requesterInternalId,
                             long requestedAt) {
        if (!StringUtils.hasText(ownerInternalId) || !StringUtils.hasText(roomId)
                || !StringUtils.hasText(requesterInternalId)) {
            return Mono.empty();
        }
        String key = PREFIX + ownerInternalId;
        String field = roomId + ":" + requesterInternalId;
        String value = Long.toString(requestedAt);
        return redisTemplate.opsForHash()
                .hasKey(key, field)
                .defaultIfEmpty(false)
                .flatMap(exists -> prepareSlot(key, Boolean.TRUE.equals(exists)))
                .then(putAndExpire(key, field, value));
    }

    /**
     * Drain all pending requests and delete the HASH.
     *
     * @param ownerInternalId connecting owner
     * @return pending facts (empty if none / blank id)
     */
    public Flux<PendingKeyRequest> drain(String ownerInternalId) {
        if (!StringUtils.hasText(ownerInternalId)) {
            return Flux.empty();
        }
        String key = PREFIX + ownerInternalId;
        return redisTemplate.opsForHash()
                .entries(key)
                .collectList()
                .flatMapMany(entries -> redisTemplate.delete(key)
                        .thenMany(Flux.fromIterable(entries)))
                .mapNotNull(RoomKeyRequestInboxRepository::parseEntry);
    }

    private Mono<Void> prepareSlot(String key, boolean fieldExists) {
        if (fieldExists) {
            return Mono.empty();
        }
        return redisTemplate.opsForHash()
                .size(key)
                .defaultIfEmpty(0L)
                .flatMap(size -> size >= MAX_FIELDS ? evictOldest(key) : Mono.empty());
    }

    private Mono<Void> evictOldest(String key) {
        return redisTemplate.opsForHash()
                .entries(key)
                .collectList()
                .flatMap(entries -> entries.stream()
                        .min(Comparator.comparingLong(RoomKeyRequestInboxRepository::requestedAtOf))
                        .map(oldest -> redisTemplate.opsForHash()
                                .remove(key, oldest.getKey())
                                .then())
                        .orElse(Mono.empty()));
    }

    private Mono<Void> putAndExpire(String key, String field, String value) {
        return redisTemplate.opsForHash()
                .put(key, field, value)
                .then(redisTemplate.expire(key, TTL))
                .then();
    }

    private static PendingKeyRequest parseEntry(Map.Entry<Object, Object> entry) {
        String field = String.valueOf(entry.getKey());
        int sep = field.lastIndexOf(':');
        if (sep <= 0 || sep >= field.length() - 1) {
            return null;
        }
        return new PendingKeyRequest(
                field.substring(0, sep),
                field.substring(sep + 1),
                requestedAtOf(entry));
    }

    private static long requestedAtOf(Map.Entry<Object, Object> entry) {
        try {
            return Long.parseLong(String.valueOf(entry.getValue()));
        } catch (NumberFormatException ex) {
            return 0L;
        }
    }

    /**
     * Inbox fact: who asked for a key, in which room, and when.
     *
     * @param roomId room id
     * @param requesterInternalId member id
     * @param requestedAt epoch millis
     */
    public record PendingKeyRequest(String roomId, String requesterInternalId, long requestedAt) {
    }
}

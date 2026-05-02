package dev.burnedchats.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.model.ChatRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;

/**
 * Redis repository for pending chat requests.
 *
 * <p>Stores chat requests using Redis List with key pattern: {@code request:{recipientInternalId}}
 *
 * <p>Each recipient has a list of pending requests from different senders.
 * Requests are stored as JSON strings and automatically expire after 5 minutes.
 *
 * <p>Operations:
 * <ul>
 *   <li>LPUSH - add new request to front of list</li>
 *   <li>LRANGE - get all pending requests</li>
 *   <li>LREM - remove specific request</li>
 * </ul>
 *
 * <p>Default TTL: 5 minutes (requests expire automatically).
 *
 * @see ChatRequest
 */
@Repository
@SuppressWarnings("checkstyle:JavadocMethod")
public class RequestRepository {

    private static final Logger LOG = LoggerFactory.getLogger(RequestRepository.class);

    private static final String KEY_PREFIX = "request:";
    private static final Duration DEFAULT_TTL = Duration.ofMinutes(5);

    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final ObjectMapper objectMapper;

    public RequestRepository(ReactiveRedisTemplate<String, String> redisTemplate,
                             ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    /**
     * Save a chat request to recipient's request queue.
     *
     * @param request chat request to save
     * @return position in list
     */
    public Mono<Long> save(ChatRequest request) {
        String key = keyFor(String.valueOf(request.getRecipientTgId()));

        return Mono.fromCallable(() -> objectMapper.writeValueAsString(request))
                .flatMap(json -> redisTemplate.opsForList().leftPush(key, json))
                .flatMap(size -> redisTemplate.expire(key, DEFAULT_TTL).thenReturn(size))
                .doOnSuccess(size -> LOG.debug("Saved request for recipient {}, session {}, queue size: {}",
                        request.getRecipientTgId(), request.getSessionId(), size))
                .onErrorResume(JsonProcessingException.class, e -> {
                    LOG.error("Failed to serialize chat request: {}", e.getMessage());
                    return Mono.error(new RuntimeException("Failed to serialize request", e));
                });
    }

    /**
     * Get all pending requests for a recipient.
     *
     * @param recipientTgId recipient's Telegram ID
     * @return flux of pending requests
     */
    public Flux<ChatRequest> findByRecipient(String recipientInternalId) {
        String key = keyFor(recipientInternalId);

        return redisTemplate.opsForList()
                .range(key, 0, -1)
                .flatMap(json -> {
                    ChatRequest request = parseRequest(json);
                    if (request != null) {
                        return reactor.core.publisher.Mono.just(request);
                    }
                    return reactor.core.publisher.Mono.empty();
                })
                .filter(request -> !request.isExpired())
                .doOnComplete(() -> LOG.debug("Retrieved requests for recipient: {}", recipientInternalId));
    }

    public Flux<ChatRequest> findByRecipient(Long recipientTgId) {
        return findByRecipient(String.valueOf(recipientTgId));
    }

    /**
     * Find a specific request by session ID.
     *
     * @param recipientTgId recipient's Telegram ID
     * @param sessionId session UUID
     * @return the request if found
     */
    public Mono<ChatRequest> findBySessionId(String recipientInternalId, String sessionId) {
        return findByRecipient(recipientInternalId)
                .filter(request -> sessionId.equals(request.getSessionId()))
                .next()
                .doOnSuccess(request -> {
                    if (request != null) {
                        LOG.debug("Found request for session: {}", sessionId);
                    } else {
                        LOG.debug("Request not found for session: {}", sessionId);
                    }
                });
    }

    public Mono<ChatRequest> findBySessionId(Long recipientTgId, String sessionId) {
        return findBySessionId(String.valueOf(recipientTgId), sessionId);
    }

    /**
     * Find a specific request by session ID (searching all recipients).
     *
     * <p>Note: This scans all request keys - use sparingly.
     *
     * @param sessionId session UUID
     * @return the request if found
     */
    public Mono<ChatRequest> findBySessionId(String sessionId) {
        return redisTemplate.keys(KEY_PREFIX + "*")
                .flatMap(key -> redisTemplate.opsForList().range(key, 0, -1))
                .map(this::parseRequest)
                .filter(request -> request != null && sessionId.equals(request.getSessionId()))
                .next()
                .doOnSuccess(request -> {
                    if (request != null) {
                        LOG.debug("Found request for session: {}", sessionId);
                    }
                });
    }

    /**
     * Remove a request from recipient's queue.
     *
     * @param recipientTgId recipient's Telegram ID
     * @param sessionId session UUID to remove
     * @return true if removed
     */
    public Mono<Boolean> delete(String recipientInternalId, String sessionId) {
        String key = keyFor(recipientInternalId);

        return findBySessionId(recipientInternalId, sessionId)
                .flatMap(request -> {
                    try {
                        String json = objectMapper.writeValueAsString(request);
                        return redisTemplate.opsForList()
                                .remove(key, 1, json)
                                .map(removed -> removed > 0);
                    } catch (JsonProcessingException e) {
                        return Mono.error(new RuntimeException("Failed to serialize request", e));
                    }
                })
                .defaultIfEmpty(false)
                .doOnSuccess(removed -> LOG.debug("Deleted request for session {}: {}", sessionId, removed));
    }

    public Mono<Boolean> delete(Long recipientTgId, String sessionId) {
        return delete(String.valueOf(recipientTgId), sessionId);
    }

    /**
     * Delete all requests for a recipient.
     *
     * @param recipientTgId recipient's Telegram ID
     * @return number of keys deleted
     */
    public Mono<Long> deleteAll(String recipientInternalId) {
        String key = keyFor(recipientInternalId);

        return redisTemplate.delete(key)
                .doOnSuccess(count -> LOG.debug("Deleted all requests for recipient {}: {} keys",
                        recipientInternalId, count));
    }

    public Mono<Long> deleteAll(Long recipientTgId) {
        return deleteAll(String.valueOf(recipientTgId));
    }

    /**
     * Get count of pending requests for a recipient.
     *
     * @param recipientTgId recipient's Telegram ID
     * @return number of pending requests
     */
    public Mono<Long> countByRecipient(String recipientInternalId) {
        String key = keyFor(recipientInternalId);

        return redisTemplate.opsForList().size(key);
    }

    public Mono<Long> countByRecipient(Long recipientTgId) {
        return countByRecipient(String.valueOf(recipientTgId));
    }

    /**
     * Check if a request exists between sender and recipient.
     *
     * @param senderTgId sender's Telegram ID
     * @param recipientTgId recipient's Telegram ID
     * @return true if request exists
     */
    public Mono<Boolean> existsBetween(Long senderTgId, String recipientInternalId) {
        return findByRecipient(recipientInternalId)
                .filter(request -> senderTgId.equals(request.getSenderTgId()))
                .hasElements();
    }

    public Mono<Boolean> existsBetween(Long senderTgId, Long recipientTgId) {
        return existsBetween(senderTgId, String.valueOf(recipientTgId));
    }

    /**
     * Refresh TTL on recipient's request queue.
     *
     * @param recipientTgId recipient's Telegram ID
     * @return true if TTL was set
     */
    public Mono<Boolean> refreshTtl(String recipientInternalId) {
        return redisTemplate.expire(keyFor(recipientInternalId), DEFAULT_TTL);
    }

    public Mono<Boolean> refreshTtl(Long recipientTgId) {
        return refreshTtl(String.valueOf(recipientTgId));
    }

    private String keyFor(String recipientInternalId) {
        return KEY_PREFIX + recipientInternalId;
    }

    private ChatRequest parseRequest(String json) {
        if (json == null || json.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.readValue(json, ChatRequest.class);
        } catch (JsonProcessingException e) {
            LOG.warn("Failed to parse chat request: {}", e.getMessage());
            return null;
        }
    }
}

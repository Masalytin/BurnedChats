package dev.burnedchats.repository;

import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/**
 * Redis repository for chat sessions.
 *
 * <p>Stores session data using Redis Hash with key pattern: {@code session:{sessionId}}
 *
 * <p>Session fields stored:
 * <ul>
 *   <li>id - session UUID</li>
 *   <li>initiatorId - Telegram ID of session creator</li>
 *   <li>responderId - Telegram ID of recipient</li>
 *   <li>status - session status enum</li>
 *   <li>createdAt - creation timestamp</li>
 *   <li>lastActivityAt - last activity timestamp</li>
 *   <li>initiatorVerified - whether initiator verified fingerprint</li>
 *   <li>responderVerified - whether responder verified fingerprint</li>
 *   <li>secretQuestion - optional secret question</li>
 *   <li>secretAnswerHash - hash of secret answer</li>
 * </ul>
 *
 * <p>Default TTL: 1 hour (auto-cleanup of inactive sessions).
 *
 * @see Session
 */
@Repository
public class SessionRepository {

    private static final Logger log = LoggerFactory.getLogger(SessionRepository.class);

    private static final String KEY_PREFIX = "session:";
    private static final Duration DEFAULT_TTL = Duration.ofHours(1);

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    public SessionRepository(ReactiveRedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * Find session by ID.
     *
     * @param sessionId session UUID
     * @return session if found, empty Mono otherwise
     */
    public Mono<Session> findById(String sessionId) {
        String key = keyFor(sessionId);

        return redisTemplate.opsForHash()
                .entries(key)
                .collectMap(
                        entry -> entry.getKey().toString(),
                        entry -> entry.getValue().toString()
                )
                .filter(map -> !map.isEmpty())
                .map(this::mapToSession)
                .doOnSuccess(session -> {
                    if (session != null) {
                        log.debug("Found session: {}", sessionId);
                    } else {
                        log.debug("Session not found: {}", sessionId);
                    }
                });
    }

    /**
     * Save session to Redis.
     *
     * @param session session to save
     * @return true if saved successfully
     */
    public Mono<Boolean> save(Session session) {
        String key = keyFor(session.getId());
        Map<String, String> hash = sessionToMap(session);

        return redisTemplate.opsForHash()
                .putAll(key, hash)
                .then(redisTemplate.expire(key, DEFAULT_TTL))
                .doOnSuccess(result -> log.debug("Saved session: {}, status: {}",
                        session.getId(), session.getStatus()));
    }

    /**
     * Update session status.
     *
     * @param sessionId session UUID
     * @param status new status
     * @return true if updated
     */
    public Mono<Boolean> updateStatus(String sessionId, SessionStatus status) {
        String key = keyFor(sessionId);

        return redisTemplate.opsForHash()
                .put(key, "status", status.name())
                .flatMap(result -> updateLastActivity(sessionId))
                .doOnSuccess(result -> log.debug("Updated session {} status to {}", sessionId, status));
    }

    /**
     * Update last activity timestamp.
     *
     * @param sessionId session UUID
     * @return true if updated
     */
    public Mono<Boolean> updateLastActivity(String sessionId) {
        String key = keyFor(sessionId);
        String now = String.valueOf(Instant.now().toEpochMilli());

        return redisTemplate.opsForHash()
                .put(key, "lastActivityAt", now);
    }

    /**
     * Atomically set public key for a participant during handshake.
     * Uses Redis HSET to update only the specific field, avoiding race conditions.
     *
     * @param sessionId session UUID
     * @param userId    Telegram user ID of the participant
     * @param publicKey Base64-encoded public key
     * @return Mono with the updated session, or empty if user is not a participant
     */
    public Mono<Session> setPublicKeyAtomic(String sessionId, Long userId, String publicKey) {
        String key = keyFor(sessionId);

        return findById(sessionId)
                .flatMap(session -> {
                    String field;
                    if (userId.equals(session.getInitiatorId())) {
                        field = "initiatorPublicKey";
                    } else if (userId.equals(session.getResponderId())) {
                        field = "responderPublicKey";
                    } else {
                        return Mono.empty(); // Not a participant
                    }

                    // Atomically set only the public key field and lastActivityAt
                    String now = String.valueOf(Instant.now().toEpochMilli());
                    return redisTemplate.opsForHash()
                            .put(key, field, publicKey)
                            .then(redisTemplate.opsForHash().put(key, "lastActivityAt", now))
                            .then(findById(sessionId)) // Re-read to get both keys
                            .doOnSuccess(s -> log.debug(
                                    "Atomically set {} for session {}", field, sessionId));
                });
    }

    /**
     * Atomically clear public keys and update status after handshake relay.
     *
     * @param sessionId session UUID
     * @return true if cleared
     */
    public Mono<Boolean> clearPublicKeysAndSetActive(String sessionId) {
        String key = keyFor(sessionId);
        String now = String.valueOf(Instant.now().toEpochMilli());

        return redisTemplate.opsForHash()
                .remove(key, "initiatorPublicKey", "responderPublicKey")
                .then(redisTemplate.opsForHash().put(key, "status", SessionStatus.ACTIVE.name()))
                .then(redisTemplate.opsForHash().put(key, "handshakeCompletedAt", now))
                .then(redisTemplate.opsForHash().put(key, "lastActivityAt", now))
                .doOnSuccess(result -> log.debug(
                        "Cleared public keys and set ACTIVE for session: {}", sessionId));
    }

    /**
     * Update verification status for a participant.
     *
     * @param sessionId session UUID
     * @param userId Telegram user ID of participant
     * @param verified whether verified
     * @return true if updated
     */
    public Mono<Boolean> updateVerification(String sessionId, Long userId, boolean verified) {
        String key = keyFor(sessionId);

        // First determine if user is initiator or responder
        return findById(sessionId)
                .flatMap(session -> {
                    String field = userId.equals(session.getInitiatorId())
                            ? "initiatorVerified"
                            : "responderVerified";
                    return redisTemplate.opsForHash()
                            .put(key, field, String.valueOf(verified))
                            .doOnSuccess(result -> log.debug(
                                    "Updated verification for session {}, user {}: {}",
                                    sessionId, userId, verified));
                })
                .defaultIfEmpty(false);
    }

    /**
     * Set handshake completed timestamp.
     *
     * @param sessionId session UUID
     * @return true if updated
     */
    public Mono<Boolean> setHandshakeCompleted(String sessionId) {
        String key = keyFor(sessionId);
        String now = String.valueOf(Instant.now().toEpochMilli());

        return redisTemplate.opsForHash()
                .put(key, "handshakeCompletedAt", now)
                .flatMap(result -> updateStatus(sessionId, SessionStatus.ACTIVE))
                .doOnSuccess(result -> log.debug("Handshake completed for session: {}", sessionId));
    }

    /**
     * Delete session and all associated data.
     *
     * @param sessionId session UUID
     * @return number of keys deleted
     */
    public Mono<Long> delete(String sessionId) {
        String key = keyFor(sessionId);

        return redisTemplate.delete(key)
                .doOnSuccess(count -> log.debug("Deleted session: {}, keys: {}", sessionId, count));
    }

    /**
     * Check if session exists.
     *
     * @param sessionId session UUID
     * @return true if exists
     */
    public Mono<Boolean> exists(String sessionId) {
        return redisTemplate.hasKey(keyFor(sessionId));
    }

    /**
     * Refresh session TTL (extend expiration).
     *
     * @param sessionId session UUID
     * @return true if TTL was set
     */
    public Mono<Boolean> refreshTtl(String sessionId) {
        return redisTemplate.expire(keyFor(sessionId), DEFAULT_TTL);
    }

    /**
     * Find sessions by participant user ID.
     *
     * <p>Note: This is an expensive operation as it scans all session keys.
     * Use sparingly and consider maintaining a separate index if needed frequently.
     *
     * @param userId Telegram user ID
     * @return active session for user, if any
     */
    public Mono<Session> findActiveByParticipant(Long userId) {
        // For now, this is a simple scan implementation
        // In production, consider maintaining a user->session index
        return redisTemplate.keys(KEY_PREFIX + "*")
                .flatMap(key -> redisTemplate.opsForHash().entries(key)
                        .collectMap(
                                entry -> entry.getKey().toString(),
                                entry -> entry.getValue().toString()
                        )
                        .filter(map -> !map.isEmpty())
                        .map(this::mapToSession))
                .filter(session -> session.isParticipant(userId)
                        && session.getStatus() != SessionStatus.BURNED
                        && session.getStatus() != SessionStatus.EXPIRED)
                .next()
                .doOnSuccess(session -> {
                    if (session != null) {
                        log.debug("Found active session for user {}: {}", userId, session.getId());
                    }
                });
    }

    /**
     * Find ALL active sessions for a participant (4.6.1).
     *
     * <p>Returns all sessions where the user is a participant and the session
     * is not burned or expired. Used for displaying active sessions list.
     *
     * <p>Note: This is an expensive operation as it scans all session keys.
     * Consider maintaining a user->sessions index for better performance.
     *
     * @param userId Telegram user ID
     * @return flux of active sessions for user
     */
    public Flux<Session> findAllActiveByParticipant(Long userId) {
        log.debug("Finding all active sessions for user: {}", userId);
        
        return redisTemplate.keys(KEY_PREFIX + "*")
                .flatMap(key -> redisTemplate.opsForHash().entries(key)
                        .collectMap(
                                entry -> entry.getKey().toString(),
                                entry -> entry.getValue().toString()
                        )
                        .filter(map -> !map.isEmpty())
                        .map(this::mapToSession))
                .filter(session -> session.isParticipant(userId)
                        && session.getStatus() != SessionStatus.BURNED
                        && session.getStatus() != SessionStatus.EXPIRED)
                .doOnComplete(() -> log.debug("Completed finding active sessions for user: {}", userId));
    }

    private String keyFor(String sessionId) {
        return KEY_PREFIX + sessionId;
    }

    private Session mapToSession(Map<String, String> hash) {
        return Session.builder()
                .id(hash.get("id"))
                .initiatorId(parseLongOrNull(hash.get("initiatorId")))
                .responderId(parseLongOrNull(hash.get("responderId")))
                .status(parseStatus(hash.get("status")))
                .createdAt(parseInstantOrNow(hash.get("createdAt")))
                .lastActivityAt(parseInstantOrNow(hash.get("lastActivityAt")))
                .handshakeCompletedAt(parseInstantOrNull(hash.get("handshakeCompletedAt")))
                .initiatorVerified(parseBoolean(hash.get("initiatorVerified")))
                .responderVerified(parseBoolean(hash.get("responderVerified")))
                .secretQuestion(hash.get("secretQuestion"))
                .secretAnswerHash(hash.get("secretAnswerHash"))
                .initiatorPublicKey(hash.get("initiatorPublicKey"))
                .responderPublicKey(hash.get("responderPublicKey"))
                .build();
    }

    private Map<String, String> sessionToMap(Session session) {
        Map<String, String> map = new HashMap<>();
        map.put("id", session.getId());

        if (session.getInitiatorId() != null) {
            map.put("initiatorId", session.getInitiatorId().toString());
        }
        if (session.getResponderId() != null) {
            map.put("responderId", session.getResponderId().toString());
        }

        map.put("status", session.getStatus().name());
        map.put("createdAt", String.valueOf(session.getCreatedAt().toEpochMilli()));
        map.put("lastActivityAt", String.valueOf(session.getLastActivityAt().toEpochMilli()));

        if (session.getHandshakeCompletedAt() != null) {
            map.put("handshakeCompletedAt",
                    String.valueOf(session.getHandshakeCompletedAt().toEpochMilli()));
        }

        map.put("initiatorVerified", String.valueOf(session.isInitiatorVerified()));
        map.put("responderVerified", String.valueOf(session.isResponderVerified()));

        if (session.getSecretQuestion() != null) {
            map.put("secretQuestion", session.getSecretQuestion());
        }
        if (session.getSecretAnswerHash() != null) {
            map.put("secretAnswerHash", session.getSecretAnswerHash());
        }

        // Temporary public keys during handshake (relayed to peers, then cleared)
        if (session.getInitiatorPublicKey() != null) {
            map.put("initiatorPublicKey", session.getInitiatorPublicKey());
        }
        if (session.getResponderPublicKey() != null) {
            map.put("responderPublicKey", session.getResponderPublicKey());
        }

        return map;
    }

    private Long parseLongOrNull(String value) {
        if (value == null || value.isEmpty()) {
            return null;
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private Instant parseInstantOrNow(String value) {
        Instant instant = parseInstantOrNull(value);
        return instant != null ? instant : Instant.now();
    }

    private Instant parseInstantOrNull(String value) {
        if (value == null || value.isEmpty()) {
            return null;
        }
        try {
            return Instant.ofEpochMilli(Long.parseLong(value));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private SessionStatus parseStatus(String value) {
        if (value == null || value.isEmpty()) {
            return SessionStatus.PENDING;
        }
        try {
            return SessionStatus.valueOf(value);
        } catch (IllegalArgumentException e) {
            return SessionStatus.PENDING;
        }
    }

    private boolean parseBoolean(String value) {
        return Boolean.parseBoolean(value);
    }
}

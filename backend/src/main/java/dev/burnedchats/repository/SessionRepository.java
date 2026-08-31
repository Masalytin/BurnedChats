package dev.burnedchats.repository;

import dev.burnedchats.config.SessionProperties;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.util.InternalIds;
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
 *   <li>secretAnswerHash - Base64 SHA-256 of normalized expected answer (if question set)</li>
 * </ul>
 *
 * <p>Session key TTL depends on status: PENDING uses {@code session.request.ttl};
 * HANDSHAKE / ACTIVE / others use {@code session.active.ttl}.
 *
 * @see Session
 */
@Repository
public class SessionRepository {

    private static final Logger LOG = LoggerFactory.getLogger(SessionRepository.class);

    private static final String KEY_PREFIX = "session:";

    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final Duration pendingTtl;
    private final Duration activeTtl;

    public SessionRepository(
            ReactiveRedisTemplate<String, String> redisTemplate,
            SessionProperties sessionProperties) {
        this.redisTemplate = redisTemplate;
        this.pendingTtl = Duration.ofSeconds(sessionProperties.getRequest().getTtl());
        this.activeTtl = Duration.ofSeconds(sessionProperties.getActive().getTtl());
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
                        LOG.debug("Found session: {}", sessionId);
                    } else {
                        LOG.debug("Session not found: {}", sessionId);
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
                .then(redisTemplate.expire(key, ttlFor(session)))
                .doOnSuccess(result -> LOG.debug("Saved session: {}, status: {}",
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
                .doOnSuccess(result -> LOG.debug("Updated session {} status to {}", sessionId, status));
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
    public Mono<Session> setPublicKeyAtomic(String sessionId, String userId, String publicKey) {
        String key = keyFor(sessionId);

        return findById(sessionId)
                .flatMap(session -> {
                    String field;
                    if (userId.equals(session.getInitiatorInternalId())) {
                        field = "initiatorPublicKey";
                    } else if (userId.equals(session.getResponderInternalId())) {
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
                            .doOnSuccess(s -> LOG.debug(
                                    "Atomically set {} for session {}", field, sessionId));
                });
    }

    public Mono<Session> setPublicKeyAtomic(String sessionId, Long telegramId, String publicKey) {
        return setPublicKeyAtomic(sessionId, InternalIds.forTelegramId(telegramId), publicKey);
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
                .doOnSuccess(result -> LOG.debug(
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
    public Mono<Boolean> updateVerification(String sessionId, String userId, boolean verified) {
        String key = keyFor(sessionId);

        // First determine if user is initiator or responder
        return findById(sessionId)
                .flatMap(session -> {
                    String field = userId.equals(session.getInitiatorInternalId())
                            ? "initiatorVerified"
                            : "responderVerified";
                    // HSET returns true only when the field is created for the first time;
                    // initiatorVerified/responderVerified always already exist (written on save()),
                    // so the raw put() result is false even though the write succeeds. Report
                    // success of the write itself; defaultIfEmpty(false) below still covers the
                    // "session not found / not a participant" case.
                    return redisTemplate.opsForHash()
                            .put(key, field, String.valueOf(verified))
                            .thenReturn(true)
                            .doOnSuccess(result -> LOG.debug(
                                    "Updated verification for session {}, user {}: {}",
                                    sessionId, userId, verified));
                })
                .defaultIfEmpty(false);
    }

    public Mono<Boolean> updateVerification(String sessionId, Long telegramId, boolean verified) {
        return updateVerification(sessionId, InternalIds.forTelegramId(telegramId), verified);
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
                .doOnSuccess(result -> LOG.debug("Handshake completed for session: {}", sessionId));
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
                .doOnSuccess(count -> LOG.debug("Deleted session: {}, keys: {}", sessionId, count));
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
        return redisTemplate.expire(keyFor(sessionId), activeTtl);
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
    public Mono<Session> findActiveByParticipant(String userId) {
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
                        && session.getStatus() != SessionStatus.EXPIRED
                        && !isLogicallyExpiredPending(session))
                .next()
                .doOnSuccess(session -> {
                    if (session != null) {
                        LOG.debug("Found active session for user {}: {}", userId, session.getId());
                    }
                });
    }

    public Mono<Session> findActiveByParticipant(Long telegramId) {
        return findActiveByParticipant(InternalIds.forTelegramId(telegramId));
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
    public Flux<Session> findAllActiveByParticipant(String userId) {
        LOG.debug("Finding all active sessions for user: {}", userId);
        
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
                .doOnComplete(() -> LOG.debug("Completed finding active sessions for user: {}", userId));
    }

    public Flux<Session> findAllActiveByParticipant(Long telegramId) {
        return findAllActiveByParticipant(InternalIds.forTelegramId(telegramId));
    }

    private Duration ttlFor(Session session) {
        if (session.getStatus() == SessionStatus.PENDING) {
            return pendingTtl;
        }
        return activeTtl;
    }

    private boolean isLogicallyExpiredPending(Session session) {
        return session.getStatus() == SessionStatus.PENDING && session.isExpired(pendingTtl);
    }

    private String keyFor(String sessionId) {
        return KEY_PREFIX + sessionId;
    }

    private Session mapToSession(Map<String, String> hash) {
        Long initiatorTelegramId = parseLongOrNull(hash.get("initiatorTelegramId"));
        if (initiatorTelegramId == null) {
            initiatorTelegramId = parseLongOrNull(hash.get("initiatorId"));
        }
        Long responderTelegramId = parseLongOrNull(hash.get("responderTelegramId"));
        if (responderTelegramId == null) {
            responderTelegramId = parseLongOrNull(hash.get("responderId"));
        }
        String initiatorInternalId = hash.get("initiatorInternalId");
        if ((initiatorInternalId == null || initiatorInternalId.isBlank()) && initiatorTelegramId != null) {
            initiatorInternalId = InternalIds.forTelegramId(initiatorTelegramId);
        }
        String responderInternalId = hash.get("responderInternalId");
        if ((responderInternalId == null || responderInternalId.isBlank()) && responderTelegramId != null) {
            responderInternalId = InternalIds.forTelegramId(responderTelegramId);
        }
        return Session.builder()
                .id(hash.get("id"))
                .initiatorInternalId(initiatorInternalId)
                .initiatorTelegramId(initiatorTelegramId)
                .responderInternalId(responderInternalId)
                .responderTelegramId(responderTelegramId)
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

        if (session.getInitiatorInternalId() != null) {
            map.put("initiatorInternalId", session.getInitiatorInternalId());
        }
        if (session.getInitiatorTelegramId() != null) {
            map.put("initiatorTelegramId", String.valueOf(session.getInitiatorTelegramId()));
            map.put("initiatorId", String.valueOf(session.getInitiatorTelegramId()));
        }
        if (session.getResponderInternalId() != null) {
            map.put("responderInternalId", session.getResponderInternalId());
        }
        if (session.getResponderTelegramId() != null) {
            map.put("responderTelegramId", String.valueOf(session.getResponderTelegramId()));
            map.put("responderId", String.valueOf(session.getResponderTelegramId()));
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

    private Instant parseInstantOrNow(String value) {
        Instant instant = parseInstantOrNull(value);
        return instant != null ? instant : Instant.now();
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

package dev.burnedchats.repository;

import dev.burnedchats.config.FileStorageProperties;
import dev.burnedchats.model.FileMetadata;
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
 * Redis repository for file metadata.
 *
 * <p>Key pattern: {@code file_meta:{fileId}} — Hash with TTL (default 24h).
 *
 * <p>Secondary index: {@code file_context:{contextId}} — Set of fileIds
 * belonging to a session or room (used for burn cascade).
 *
 * @see FileMetadata
 */
@Repository
public class FileMetadataRepository {

    private static final Logger LOG = LoggerFactory.getLogger(FileMetadataRepository.class);

    private static final String META_PREFIX = "file_meta:";
    private static final String CONTEXT_PREFIX = "file_context:";

    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final FileStorageProperties properties;
    private final RoomRepository roomRepository;

    public FileMetadataRepository(ReactiveRedisTemplate<String, String> redisTemplate,
                                  FileStorageProperties properties,
                                  RoomRepository roomRepository) {
        this.redisTemplate = redisTemplate;
        this.properties = properties;
        this.roomRepository = roomRepository;
    }

    /**
     * Save file metadata with TTL and add to context index.
     *
     * @param metadata file metadata to save
     * @return true if saved successfully
     */
    public Mono<Boolean> save(FileMetadata metadata) {
        String metaKey = metaKeyFor(metadata.getFileId());
        String contextKey = contextKeyFor(metadata.getContextId());
        Map<String, String> hash = toMap(metadata);

        return resolveTtl(metadata)
                .flatMap(ttl -> redisTemplate.opsForHash()
                .putAll(metaKey, hash)
                .then(redisTemplate.expire(metaKey, ttl))
                .flatMap(ok -> redisTemplate.opsForSet()
                        .add(contextKey, metadata.getFileId())
                        .then(redisTemplate.expire(contextKey, ttl))
                        .thenReturn(true)))
                .doOnSuccess(r -> LOG.debug("Saved file metadata: {}, context: {}:{}",
                        metadata.getFileId(), metadata.getContextType(), metadata.getContextId()));
    }

    /**
     * Find file metadata by file ID.
     *
     * @param fileId unique file identifier
     * @return metadata if found, empty Mono otherwise
     */
    public Mono<FileMetadata> findById(String fileId) {
        String key = metaKeyFor(fileId);

        return redisTemplate.opsForHash()
                .entries(key)
                .collectMap(
                        entry -> entry.getKey().toString(),
                        entry -> entry.getValue().toString()
                )
                .filter(map -> !map.isEmpty())
                .map(map -> fromMap(fileId, map))
                .doOnSuccess(meta -> {
                    if (meta != null) {
                        LOG.debug("Found file metadata: {}", fileId);
                    } else {
                        LOG.debug("File metadata not found: {}", fileId);
                    }
                });
    }

    /**
     * Delete file metadata and remove from context index.
     *
     * @param fileId unique file identifier
     * @return true if deleted
     */
    public Mono<Boolean> delete(String fileId) {
        String metaKey = metaKeyFor(fileId);

        return findById(fileId)
                .flatMap(meta -> {
                    String contextKey = contextKeyFor(meta.getContextId());
                    return redisTemplate.opsForSet()
                            .remove(contextKey, fileId)
                            .then(redisTemplate.delete(metaKey))
                            .map(count -> count > 0);
                })
                .defaultIfEmpty(false)
                .doOnSuccess(deleted -> LOG.debug("Deleted file metadata: {}, result: {}", fileId, deleted));
    }

    /**
     * Find all file IDs belonging to a given context (session or room).
     * Used by burn cascade to delete all files when a session/room is destroyed.
     *
     * @param contextId session ID or room ID
     * @return stream of file IDs
     */
    public Flux<String> findFileIdsByContextId(String contextId) {
        String contextKey = contextKeyFor(contextId);

        return redisTemplate.opsForSet()
                .members(contextKey)
                .doOnComplete(() -> LOG.debug("Listed files for context: {}", contextId));
    }

    /**
     * Delete the context index key ({@code file_context:{contextId}}).
     * Used by burn cascade after all individual file entries have been removed.
     *
     * @param contextId session ID or room ID
     * @return true if the key existed and was deleted
     */
    public Mono<Boolean> deleteContextKey(String contextId) {
        String key = contextKeyFor(contextId);
        return redisTemplate.delete(key)
                .map(count -> count > 0)
                .doOnSuccess(deleted -> LOG.debug("Deleted context key {}: {}", key, deleted));
    }

    /**
     * Check whether metadata exists for a file (i.e. TTL has not expired).
     *
     * @param fileId unique file identifier
     * @return true if metadata exists
     */
    public Mono<Boolean> exists(String fileId) {
        return redisTemplate.hasKey(metaKeyFor(fileId));
    }

    private String metaKeyFor(String fileId) {
        return META_PREFIX + fileId;
    }

    private String contextKeyFor(String contextId) {
        return CONTEXT_PREFIX + contextId;
    }

    private Map<String, String> toMap(FileMetadata meta) {
        Map<String, String> map = new HashMap<>();
        if (meta.getUploaderInternalId() != null) {
            map.put("uploaderInternalId", meta.getUploaderInternalId());
        }
        if (meta.getUploaderTgId() != null) {
            map.put("uploaderTgId", meta.getUploaderTgId());
        }
        map.put("contextType", meta.getContextType());
        map.put("contextId", meta.getContextId());
        map.put("size", String.valueOf(meta.getSize()));
        map.put("createdAt", String.valueOf(
                meta.getCreatedAt() != null ? meta.getCreatedAt() : Instant.now().toEpochMilli()));
        return map;
    }

    private FileMetadata fromMap(String fileId, Map<String, String> map) {
        return FileMetadata.builder()
                .fileId(fileId)
                .uploaderInternalId(map.get("uploaderInternalId"))
                .uploaderTgId(map.get("uploaderTgId"))
                .contextType(map.get("contextType"))
                .contextId(map.get("contextId"))
                .size(parseLongOrNull(map.get("size")))
                .createdAt(parseLongOrNull(map.get("createdAt")))
                .build();
    }

    private Mono<Duration> resolveTtl(FileMetadata metadata) {
        Duration fallback = properties.getMetadataTtl();
        if (metadata == null || !"room".equalsIgnoreCase(metadata.getContextType())
                || metadata.getContextId() == null || metadata.getContextId().isBlank()) {
            return Mono.just(fallback);
        }
        String roomId = metadata.getContextId();
        return roomRepository.findById(roomId)
                .flatMap(room -> roomRepository.getRemainingTtl(roomId)
                        .defaultIfEmpty(Duration.ZERO)
                        .map(remaining -> FileStorageProperties.resolveMetadataTtl(
                                fallback,
                                room.getMessageTtl() > 0 ? room.getMessageTtl() : null,
                                remaining.isZero() ? null : remaining)))
                .defaultIfEmpty(fallback)
                .onErrorReturn(fallback);
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
}

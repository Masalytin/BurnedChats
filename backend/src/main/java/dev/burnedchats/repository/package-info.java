/**
 * Data access layer for Redis storage.
 *
 * <p>This package contains reactive repositories for Redis data access.
 * All repositories use {@link org.springframework.data.redis.core.ReactiveRedisTemplate}
 * for non-blocking operations.
 *
 * <p>Key repositories:
 * <ul>
 *   <li>{@code SessionRepository} - Chat session storage and retrieval</li>
 *   <li>{@code RequestRepository} - Pending chat request management</li>
 *   <li>{@code UserRepository} - Telegram user cache</li>
 *   <li>{@code OnlineStatusRepository} - User presence tracking</li>
 * </ul>
 *
 * <p>Data expiration is handled through Redis TTL to ensure
 * automatic cleanup of temporary data.
 */
package dev.burnedchats.repository;


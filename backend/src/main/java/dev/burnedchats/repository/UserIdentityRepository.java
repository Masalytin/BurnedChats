package dev.burnedchats.repository;

import dev.burnedchats.model.UnifiedUser;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

@Slf4j
@Repository
@RequiredArgsConstructor
public class UserIdentityRepository {
    private static final String USER_PREFIX = "user:";
    private static final String AUTH_TG_PREFIX = "auth_tg:";
    private static final String AUTH_WALLET_PREFIX = "auth_wallet:";
    private static final Duration TTL = Duration.ofDays(90);

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    public Mono<String> findByTelegramId(Long telegramId) {
        return redisTemplate.opsForValue().get(AUTH_TG_PREFIX + telegramId);
    }

    public Mono<String> findByWalletAddress(String walletAddress) {
        return redisTemplate.opsForValue().get(AUTH_WALLET_PREFIX + normalizeWallet(walletAddress));
    }

    public Mono<UnifiedUser> findOrCreateByWallet(String walletAddress) {
        String normalizedWallet = normalizeWallet(walletAddress);
        if (normalizedWallet.isBlank()) {
            return Mono.error(new IllegalArgumentException("Wallet address is required"));
        }

        return findByWalletAddress(normalizedWallet)
                .flatMap(this::findById)
                .switchIfEmpty(createWalletUser(normalizedWallet));
    }

    public Mono<UnifiedUser> findById(String internalId) {
        return redisTemplate.opsForHash()
                .entries(USER_PREFIX + internalId)
                .collectMap(
                        e -> String.valueOf(e.getKey()),
                        e -> String.valueOf(e.getValue()))
                .filter(map -> !map.isEmpty())
                .map(this::fromHash);
    }

    public Mono<Boolean> save(UnifiedUser user) {
        String key = USER_PREFIX + user.internalId();
        Map<String, String> hash = toHash(user);
        Mono<Boolean> saveUser = redisTemplate.opsForHash()
                .putAll(key, hash)
                .flatMap(ok -> redisTemplate.expire(key, TTL).thenReturn(Boolean.TRUE.equals(ok)));
        Mono<Boolean> linkTg = user.telegramId() == null
                ? Mono.just(true)
                : redisTemplate.opsForValue()
                        .set(AUTH_TG_PREFIX + user.telegramId(), user.internalId(), TTL);
        Mono<Boolean> linkWallet = user.walletAddress() == null || user.walletAddress().isBlank()
                ? Mono.just(true)
                : redisTemplate.opsForValue()
                        .set(AUTH_WALLET_PREFIX + normalizeWallet(user.walletAddress()), user.internalId(), TTL);
        return Mono.zip(saveUser, linkTg, linkWallet)
                .map(tuple -> tuple.getT1() && tuple.getT2() && tuple.getT3());
    }

    public Mono<Boolean> linkWallet(String internalId, String walletAddress) {
        String normalized = normalizeWallet(walletAddress);
        return redisTemplate.opsForValue()
                .set(AUTH_WALLET_PREFIX + normalized, internalId, TTL)
                .flatMap(ok -> redisTemplate.opsForHash()
                        .put(USER_PREFIX + internalId, "walletAddress", normalized)
                        .then(redisTemplate.expire(USER_PREFIX + internalId, TTL))
                        .thenReturn(Boolean.TRUE.equals(ok)));
    }

    public Mono<Boolean> linkTelegram(String internalId, Long telegramId) {
        return redisTemplate.opsForValue()
                .set(AUTH_TG_PREFIX + telegramId, internalId, TTL)
                .flatMap(ok -> redisTemplate.opsForHash()
                        .put(USER_PREFIX + internalId, "telegramId", String.valueOf(telegramId))
                        .then(redisTemplate.expire(USER_PREFIX + internalId, TTL))
                        .thenReturn(Boolean.TRUE.equals(ok)));
    }

    private Map<String, String> toHash(UnifiedUser user) {
        Map<String, String> hash = new HashMap<>();
        hash.put("internalId", user.internalId());
        hash.put("authType", user.authType().name());
        hash.put("displayName", user.displayName() == null ? "" : user.displayName());
        hash.put("telegramId", user.telegramId() == null ? "" : String.valueOf(user.telegramId()));
        hash.put("walletAddress", user.walletAddress() == null ? "" : normalizeWallet(user.walletAddress()));
        hash.put("avatarUrl", user.avatarUrl() == null ? "" : user.avatarUrl());
        hash.put("createdAt", String.valueOf(Instant.now().toEpochMilli()));
        return hash;
    }

    private UnifiedUser fromHash(Map<String, String> hash) {
        String tg = hash.getOrDefault("telegramId", "");
        String wallet = hash.getOrDefault("walletAddress", "");
        String avatar = hash.getOrDefault("avatarUrl", "");
        return new UnifiedUser(
                hash.get("internalId"),
                dev.burnedchats.model.enums.AuthType.valueOf(hash.get("authType")),
                hash.get("displayName"),
                tg.isBlank() ? null : Long.parseLong(tg),
                wallet.isBlank() ? null : wallet,
                avatar.isBlank() ? null : avatar);
    }

    private Mono<UnifiedUser> createWalletUser(String normalizedWallet) {
        UnifiedUser user = new UnifiedUser(
                UUID.randomUUID().toString(),
                dev.burnedchats.model.enums.AuthType.WALLET,
                shortWalletDisplayName(normalizedWallet),
                null,
                normalizedWallet,
                null);
        return save(user)
                .flatMap(saved -> Boolean.TRUE.equals(saved)
                        ? Mono.just(user)
                        : Mono.error(new IllegalStateException("Failed to save wallet user")));
    }

    private String shortWalletDisplayName(String walletAddress) {
        if (walletAddress.length() <= 8) {
            return walletAddress;
        }
        return walletAddress.substring(0, 4) + "..." + walletAddress.substring(walletAddress.length() - 4);
    }

    private String normalizeWallet(String walletAddress) {
        return walletAddress == null ? "" : walletAddress.trim().toLowerCase(Locale.ROOT);
    }
}

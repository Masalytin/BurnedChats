package dev.burnedchats.repository;

import dev.burnedchats.model.UnifiedUser;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Repository;
import org.ton.ton4j.address.Address;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
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

    /**
     * Atomic wallet rotation. Conflict is checked <em>before</em> {@code DEL} so a 409 cannot
     * orphan the current {@code auth_wallet:} mapping (see IMP-WSWITCH-01 decision log).
     */
    private static final RedisScript<String> SWITCH_WALLET = RedisScript.of(
            """
            local userKey = KEYS[1]
            local newAuthKey = KEYS[2]
            local internalId = ARGV[1]
            local newCanonical = ARGV[2]
            local ttl = tonumber(ARGV[3])
            local prefix = ARGV[4]

            local current = redis.call('HGET', userKey, 'walletAddress')
            if (not current) or current == '' then
              return 'NO_WALLET'
            end

            local existing = redis.call('GET', newAuthKey)
            if existing and existing ~= '' and existing ~= internalId then
              return 'CONFLICT'
            end

            local oldAuthKey = prefix .. current
            if oldAuthKey ~= newAuthKey then
              redis.call('DEL', oldAuthKey)
            end

            redis.call('SET', newAuthKey, internalId)
            redis.call('EXPIRE', newAuthKey, ttl)
            redis.call('HSET', userKey, 'walletAddress', newCanonical)
            redis.call('EXPIRE', userKey, ttl)
            return 'OK'
            """,
            String.class);

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

    /**
     * Binds normalized wallet address to internal id after conflict checks.
     *
     * @throws IllegalStateException on cross-account conflicts
     */
    public Mono<Void> linkWallet(String internalId, String walletAddress) {
        String normalized = normalizeWallet(walletAddress);
        if (normalized.isBlank()) {
            return Mono.error(new IllegalArgumentException("Wallet address is required"));
        }
        if (internalId == null || internalId.isBlank()) {
            return Mono.error(new IllegalArgumentException("internalId is required"));
        }
        return findByWalletAddress(normalized)
                .flatMap(ownerId -> {
                    if (internalId.equals(ownerId)) {
                        return refreshWalletLink(internalId, normalized);
                    }
                    return Mono.error(new IllegalStateException("Wallet already linked to another account"));
                })
                .switchIfEmpty(Mono.defer(() -> findById(internalId)
                        .switchIfEmpty(Mono.error(new IllegalArgumentException("User profile not found")))
                        .flatMap(user -> {
                            String existingWallet = user.walletAddress();
                            if (existingWallet != null && !existingWallet.isBlank()) {
                                String existingNorm = normalizeWallet(existingWallet);
                                if (!existingNorm.equals(normalized)) {
                                    return Mono.error(new IllegalStateException(
                                            "Another wallet is already linked; unlink it first"));
                                }
                            }
                            return applyWalletLink(internalId, normalized);
                        })));
    }

    /**
     * Binds telegram id to internal id after conflict checks.
     *
     * @throws IllegalStateException on cross-account conflicts
     */
    public Mono<Void> linkTelegram(String internalId, Long telegramId) {
        if (telegramId == null) {
            return Mono.error(new IllegalArgumentException("telegramId is required"));
        }
        if (internalId == null || internalId.isBlank()) {
            return Mono.error(new IllegalArgumentException("internalId is required"));
        }
        return findByTelegramId(telegramId)
                .flatMap(ownerId -> {
                    if (internalId.equals(ownerId)) {
                        return refreshTelegramLink(internalId, telegramId);
                    }
                    return Mono.error(new IllegalStateException("Telegram already linked to another account"));
                })
                .switchIfEmpty(Mono.defer(() -> findById(internalId)
                        .switchIfEmpty(Mono.error(new IllegalArgumentException("User profile not found")))
                        .flatMap(user -> {
                            Long existingTg = user.telegramId();
                            if (existingTg != null && !existingTg.equals(telegramId)) {
                                return Mono.error(new IllegalStateException(
                                        "Another Telegram account is already linked; unlink it first"));
                            }
                            if (existingTg != null && existingTg.equals(telegramId)) {
                                return refreshTelegramLink(internalId, telegramId);
                            }
                            return applyTelegramLink(internalId, telegramId);
                        })));
    }

    /**
     * Atomically rotates {@code auth_wallet:} and {@code user.walletAddress} to the canonical raw
     * form of {@code walletAddress}. Does not touch {@code auth_tg:} or {@code session_token:*}.
     *
     * @throws IllegalArgumentException when no wallet is linked or the address is invalid
     * @throws IllegalStateException when the new address is owned by another internalId
     */
    public Mono<Void> switchWallet(String internalId, String walletAddress) {
        if (internalId == null || internalId.isBlank()) {
            return Mono.error(new IllegalArgumentException("internalId is required"));
        }
        String canonical;
        try {
            canonical = canonicalWalletRaw(walletAddress);
        } catch (IllegalArgumentException ex) {
            return Mono.error(ex);
        }
        String userKey = USER_PREFIX + internalId;
        String newAuthKey = AUTH_WALLET_PREFIX + canonical;
        String ttlSeconds = String.valueOf(TTL.getSeconds());
        return redisTemplate.execute(
                        SWITCH_WALLET,
                        List.of(userKey, newAuthKey),
                        List.of(internalId, canonical, ttlSeconds, AUTH_WALLET_PREFIX))
                .next()
                .switchIfEmpty(Mono.error(new IllegalStateException("Failed to switch wallet")))
                .flatMap(result -> switch (result) {
                    case "OK" -> Mono.empty();
                    case "CONFLICT" -> Mono.error(
                            new IllegalStateException("Wallet already linked to another account"));
                    case "NO_WALLET" -> Mono.error(new IllegalArgumentException("No wallet linked"));
                    default -> Mono.error(new IllegalStateException("Failed to switch wallet"));
                });
    }

    /**
     * TON workchain+hash equality. Not {@link #normalizeWallet} (trim+lowercase only).
     */
    public boolean walletsEqual(String left, String right) {
        if (left == null || right == null || left.isBlank() || right.isBlank()) {
            return false;
        }
        try {
            return Address.of(left.trim()).equals(Address.of(right.trim()));
        } catch (RuntimeException | Error ex) {
            return false;
        }
    }

    /** Removes wallet mapping; Telegram must remain linked. */
    public Mono<Void> unlinkWallet(String internalId) {
        return findById(internalId)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("User profile not found")))
                .flatMap(user -> {
                    if (user.telegramId() == null) {
                        return Mono.error(new IllegalStateException("Cannot unlink the last sign-in method"));
                    }
                    String wallet = user.walletAddress();
                    if (wallet == null || wallet.isBlank()) {
                        return Mono.error(new IllegalStateException("No wallet linked"));
                    }
                    String normalized = normalizeWallet(wallet);
                    return redisTemplate.delete(AUTH_WALLET_PREFIX + normalized)
                            .then(redisTemplate.opsForHash().put(USER_PREFIX + internalId, "walletAddress", ""))
                            .then(redisTemplate.expire(USER_PREFIX + internalId, TTL))
                            .then();
                });
    }

    /** Removes telegram mapping; wallet must remain linked. */
    public Mono<Void> unlinkTelegram(String internalId) {
        return findById(internalId)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("User profile not found")))
                .flatMap(user -> {
                    String wallet = user.walletAddress();
                    if (wallet == null || wallet.isBlank()) {
                        return Mono.error(new IllegalStateException("Cannot unlink the last sign-in method"));
                    }
                    Long tg = user.telegramId();
                    if (tg == null) {
                        return Mono.error(new IllegalStateException("No Telegram linked"));
                    }
                    return redisTemplate.delete(AUTH_TG_PREFIX + tg)
                            .then(redisTemplate.opsForHash().put(USER_PREFIX + internalId, "telegramId", ""))
                            .then(redisTemplate.expire(USER_PREFIX + internalId, TTL))
                            .then();
                });
    }

    private Mono<Void> applyWalletLink(String internalId, String normalized) {
        return redisTemplate.opsForValue()
                .set(AUTH_WALLET_PREFIX + normalized, internalId, TTL)
                .flatMap(ok -> Boolean.FALSE.equals(ok)
                        ? Mono.error(new IllegalStateException("Failed to link wallet"))
                        : redisTemplate.opsForHash()
                                .put(USER_PREFIX + internalId, "walletAddress", normalized)
                                .then(redisTemplate.expire(USER_PREFIX + internalId, TTL))
                                .then());
    }

    private Mono<Void> refreshWalletLink(String internalId, String normalized) {
        return redisTemplate.opsForValue()
                .set(AUTH_WALLET_PREFIX + normalized, internalId, TTL)
                .then(redisTemplate.opsForHash().put(USER_PREFIX + internalId, "walletAddress", normalized))
                .then(redisTemplate.expire(USER_PREFIX + internalId, TTL))
                .then();
    }

    private Mono<Void> applyTelegramLink(String internalId, Long telegramId) {
        return redisTemplate.opsForValue()
                .set(AUTH_TG_PREFIX + telegramId, internalId, TTL)
                .flatMap(ok -> Boolean.FALSE.equals(ok)
                        ? Mono.error(new IllegalStateException("Failed to link telegram"))
                        : redisTemplate.opsForHash()
                                .put(USER_PREFIX + internalId, "telegramId", String.valueOf(telegramId))
                                .then(redisTemplate.expire(USER_PREFIX + internalId, TTL))
                                .then());
    }

    private Mono<Void> refreshTelegramLink(String internalId, Long telegramId) {
        return redisTemplate.opsForValue()
                .set(AUTH_TG_PREFIX + telegramId, internalId, TTL)
                .then(redisTemplate.opsForHash()
                        .put(USER_PREFIX + internalId, "telegramId", String.valueOf(telegramId)))
                .then(redisTemplate.expire(USER_PREFIX + internalId, TTL))
                .then();
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

    /**
     * Normalizes wallet address for index keys and exact-match search.
     */
    public String normalizeWallet(String walletAddress) {
        return walletAddress == null ? "" : walletAddress.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * Canonical TON raw {@code workchain:hex} used as {@code auth_wallet:} suffix after link/switch.
     */
    public String canonicalWalletRaw(String walletAddress) {
        if (walletAddress == null || walletAddress.isBlank()) {
            throw new IllegalArgumentException("Wallet address is required");
        }
        try {
            return Address.of(walletAddress.trim()).toRaw();
        } catch (RuntimeException | Error ex) {
            throw new IllegalArgumentException("Invalid wallet address", ex);
        }
    }

    /**
     * Whether the query looks like a full TON user-friendly wallet address (exact-match only).
     */
    public boolean isWalletAddressQuery(String query) {
        if (query == null || query.isBlank()) {
            return false;
        }
        String normalized = normalizeWallet(query);
        if (normalized.length() != 48) {
            return false;
        }
        char prefix = normalized.charAt(0);
        return (prefix == 'e' || prefix == 'u' || prefix == 'k' || prefix == '0')
                && normalized.chars().allMatch(c -> Character.isLetterOrDigit(c) || c == '_' || c == '-');
    }
}

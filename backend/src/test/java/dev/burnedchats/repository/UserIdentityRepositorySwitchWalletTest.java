package dev.burnedchats.repository;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.DockerImageName;
import org.ton.ton4j.address.Address;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit contract for {@code switchWallet} plus optional Testcontainers Lua tests.
 */
@DisplayName("UserIdentityRepository.switchWallet")
@SuppressWarnings("checkstyle:HideUtilityClassConstructor")
class UserIdentityRepositorySwitchWalletTest {

    private static final Duration BLOCK = Duration.ofSeconds(10);
    private static final String INTERNAL_ID = "switch-user-1";
    private static final String OTHER_ID = "other-user-2";
    private static final long TELEGRAM_ID = 424242L;
    private static final String WALLET_A_EQ = "EQBo3W19O92qLjdoYbERATFtQUh1Qp_NZJ6JU_lXyLnGUJT_";
    private static final String WALLET_B_RAW =
            "0:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private static final String WALLET_C_RAW =
            "0:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    private static final Duration NINETY_DAYS = Duration.ofDays(90);

    public static boolean dockerAvailable() {
        return DockerClientFactory.instance().isDockerAvailable();
    }

    @Nested
    @ExtendWith(MockitoExtension.class)
    @MockitoSettings(strictness = Strictness.LENIENT)
    @DisplayName("unit contract")
    class UnitContract {
        @Mock
        private ReactiveRedisTemplate<String, String> redisTemplate;

        private UserIdentityRepository repository;

        @BeforeEach
        void setUp() {
            repository = new UserIdentityRepository(redisTemplate);
        }

        @Test
        @DisplayName("EQ / UQ / raw of the same key are equal; normalizeWallet is not used")
        void eqUqRawAreEqual() {
            String raw = Address.of(WALLET_A_EQ).toRaw();
            String uq = Address.of(WALLET_A_EQ).toNonBounceable();
            assertThat(repository.walletsEqual(WALLET_A_EQ, raw)).isTrue();
            assertThat(repository.walletsEqual(WALLET_A_EQ, uq)).isTrue();
            assertThat(repository.walletsEqual(raw, uq)).isTrue();
            assertThat(repository.walletsEqual(WALLET_A_EQ, WALLET_B_RAW)).isFalse();
            assertThat(repository.normalizeWallet(WALLET_A_EQ)).isEqualTo(WALLET_A_EQ.toLowerCase());
            assertThat(repository.normalizeWallet(WALLET_A_EQ)).isNotEqualTo(raw);
            assertThat(repository.canonicalWalletRaw(WALLET_A_EQ)).isEqualTo(raw);
        }

        @Test
        @DisplayName("Lua script checks GET conflict before DEL and writes canonical raw")
        void luaChecksConflictBeforeDelAndUsesCanonicalRaw() {
            stubScriptResult("OK");
            String rawB = Address.of(WALLET_B_RAW).toRaw();

            StepVerifier.create(repository.switchWallet(INTERNAL_ID, WALLET_B_RAW))
                    .verifyComplete();

            ArgumentCaptor<RedisScript<String>> scriptCaptor = ArgumentCaptor.forClass(RedisScript.class);
            ArgumentCaptor<List<String>> keysCaptor = ArgumentCaptor.forClass(List.class);
            ArgumentCaptor<List<String>> argsCaptor = ArgumentCaptor.forClass(List.class);
            verify(redisTemplate).execute(scriptCaptor.capture(), keysCaptor.capture(), argsCaptor.capture());

            String lua = scriptCaptor.getValue().getScriptAsString();
            assertThat(lua).contains("HGET");
            assertThat(lua).contains("CONFLICT");
            assertThat(lua.indexOf("GET")).isLessThan(lua.indexOf("DEL"));
            assertThat(lua).contains("HSET");
            assertThat(lua).contains("EXPIRE");
            assertThat(keysCaptor.getValue()).containsExactly("user:" + INTERNAL_ID, "auth_wallet:" + rawB);
            assertThat(argsCaptor.getValue().get(0)).isEqualTo(INTERNAL_ID);
            assertThat(argsCaptor.getValue().get(1)).isEqualTo(rawB);
            assertThat(argsCaptor.getValue().get(2)).isEqualTo(String.valueOf(Duration.ofDays(90).getSeconds()));
            assertThat(argsCaptor.getValue().get(3)).isEqualTo("auth_wallet:");
        }

        @Test
        @DisplayName("CONFLICT script result → IllegalStateException")
        void conflictResultMapsToIllegalState() {
            stubScriptResult("CONFLICT");

            StepVerifier.create(repository.switchWallet(INTERNAL_ID, WALLET_B_RAW))
                    .expectErrorSatisfies(ex -> {
                        assertThat(ex).isInstanceOf(IllegalStateException.class);
                        assertThat(ex).hasMessage("Wallet already linked to another account");
                    })
                    .verify();
        }

        @Test
        @DisplayName("NO_WALLET script result → IllegalArgumentException")
        void noWalletResultMapsToIllegalArgument() {
            stubScriptResult("NO_WALLET");

            StepVerifier.create(repository.switchWallet(INTERNAL_ID, WALLET_B_RAW))
                    .expectErrorSatisfies(ex -> {
                        assertThat(ex).isInstanceOf(IllegalArgumentException.class);
                        assertThat(ex).hasMessage("No wallet linked");
                    })
                    .verify();
        }

        @SuppressWarnings("unchecked")
        private void stubScriptResult(String result) {
            when(redisTemplate.execute(any(RedisScript.class), anyList(), anyList()))
                    .thenReturn(Flux.just(result));
        }
    }

    @Nested
    @EnabledIf("dev.burnedchats.repository.UserIdentityRepositorySwitchWalletTest#dockerAvailable")
    @DisplayName("Lua on Redis")
    class RedisLua {
        @SuppressWarnings("resource")
        private static final GenericContainer<?> REDIS =
                new GenericContainer<>(DockerImageName.parse("redis:7-alpine"))
                        .withExposedPorts(6379)
                        .waitingFor(Wait.forLogMessage(".*Ready to accept connections.*\\n", 1)
                                .withStartupTimeout(Duration.ofSeconds(60)));

        static {
            if (dockerAvailable()) {
                REDIS.start();
            }
        }

        private LettuceConnectionFactory connectionFactory;
        private ReactiveRedisTemplate<String, String> redis;
        private UserIdentityRepository repository;

        @BeforeEach
        void setUp() {
            RedisStandaloneConfiguration config = new RedisStandaloneConfiguration(
                    REDIS.getHost(), REDIS.getMappedPort(6379));
            connectionFactory = new LettuceConnectionFactory(config);
            connectionFactory.afterPropertiesSet();
            redis = new ReactiveStringRedisTemplate(connectionFactory);
            redis.execute(connection -> connection.serverCommands().flushDb()).blockLast(BLOCK);
            repository = new UserIdentityRepository(redis);
        }

        @AfterEach
        void tearDown() {
            if (connectionFactory != null) {
                connectionFactory.destroy();
            }
        }

        @Test
        @DisplayName("moves auth_wallet and user.walletAddress to canonical raw; same internalId; auth_tg untouched")
        void switchMovesWalletMappingKeepsIdentityAndTelegram() {
            String rawA = Address.of(WALLET_A_EQ).toRaw();
            String rawB = Address.of(WALLET_B_RAW).toRaw();
            seedLinkedUser(INTERNAL_ID, TELEGRAM_ID, rawA, "Alice", "TELEGRAM");

            StepVerifier.create(repository.switchWallet(INTERNAL_ID, rawB))
                    .verifyComplete();

            assertThat(redis.opsForValue().get("auth_wallet:" + rawB).block(BLOCK)).isEqualTo(INTERNAL_ID);
            assertThat(redis.opsForValue().get("auth_wallet:" + rawA).block(BLOCK)).isNull();
            assertThat(redis.opsForHash().get("user:" + INTERNAL_ID, "walletAddress").block(BLOCK))
                    .isEqualTo(rawB);
            assertThat(redis.opsForHash().get("user:" + INTERNAL_ID, "internalId").block(BLOCK))
                    .isEqualTo(INTERNAL_ID);
            assertThat(redis.opsForHash().get("user:" + INTERNAL_ID, "authType").block(BLOCK))
                    .isEqualTo("TELEGRAM");
            assertThat(redis.opsForHash().get("user:" + INTERNAL_ID, "displayName").block(BLOCK))
                    .isEqualTo("Alice");
            assertThat(redis.opsForValue().get("auth_tg:" + TELEGRAM_ID).block(BLOCK)).isEqualTo(INTERNAL_ID);
        }

        @Test
        @DisplayName("Lua DELs auth_wallet key from HGET, not a client-supplied old address")
        void switchDeletesHashWalletNotClientSuppliedOld() {
            String rawA = Address.of(WALLET_A_EQ).toRaw();
            String rawB = Address.of(WALLET_B_RAW).toRaw();
            String clientOld = Address.of(WALLET_C_RAW).toRaw();
            seedLinkedUser(INTERNAL_ID, TELEGRAM_ID, rawA, "Alice", "TELEGRAM");
            redis.opsForValue().set("auth_wallet:" + clientOld, INTERNAL_ID, NINETY_DAYS).block(BLOCK);

            StepVerifier.create(repository.switchWallet(INTERNAL_ID, rawB))
                    .verifyComplete();

            assertThat(redis.opsForValue().get("auth_wallet:" + rawA).block(BLOCK)).isNull();
            assertThat(redis.opsForValue().get("auth_wallet:" + rawB).block(BLOCK)).isEqualTo(INTERNAL_ID);
            assertThat(redis.opsForValue().get("auth_wallet:" + clientOld).block(BLOCK))
                    .isEqualTo(INTERNAL_ID);
        }

        @Test
        @DisplayName("new address owned by another internalId → CONFLICT and no write")
        void switchConflictLeavesRedisUnchanged() {
            String rawA = Address.of(WALLET_A_EQ).toRaw();
            String rawB = Address.of(WALLET_B_RAW).toRaw();
            seedLinkedUser(INTERNAL_ID, TELEGRAM_ID, rawA, "Alice", "TELEGRAM");
            redis.opsForValue().set("auth_wallet:" + rawB, OTHER_ID, NINETY_DAYS).block(BLOCK);

            StepVerifier.create(repository.switchWallet(INTERNAL_ID, rawB))
                    .expectErrorSatisfies(ex -> {
                        assertThat(ex).isInstanceOf(IllegalStateException.class);
                        assertThat(ex).hasMessage("Wallet already linked to another account");
                    })
                    .verify();

            assertThat(redis.opsForValue().get("auth_wallet:" + rawA).block(BLOCK)).isEqualTo(INTERNAL_ID);
            assertThat(redis.opsForValue().get("auth_wallet:" + rawB).block(BLOCK)).isEqualTo(OTHER_ID);
            assertThat(redis.opsForHash().get("user:" + INTERNAL_ID, "walletAddress").block(BLOCK))
                    .isEqualTo(rawA);
        }

        @Test
        @DisplayName("same wallet EQ vs raw is a no-op: one canonical key and 90d TTL refresh")
        void sameWalletEqVsRawNoOpOneKeyTtlRefresh() {
            String rawA = Address.of(WALLET_A_EQ).toRaw();
            String eqLower = WALLET_A_EQ.toLowerCase();
            seedLinkedUser(INTERNAL_ID, TELEGRAM_ID, eqLower, "Alice", "TELEGRAM");
            redis.delete("auth_wallet:" + rawA).block(BLOCK);
            redis.opsForValue().set("auth_wallet:" + eqLower, INTERNAL_ID, Duration.ofDays(1)).block(BLOCK);
            redis.expire("user:" + INTERNAL_ID, Duration.ofDays(1)).block(BLOCK);

            StepVerifier.create(repository.switchWallet(INTERNAL_ID, WALLET_A_EQ))
                    .verifyComplete();

            assertThat(redis.opsForValue().get("auth_wallet:" + rawA).block(BLOCK)).isEqualTo(INTERNAL_ID);
            assertThat(redis.opsForValue().get("auth_wallet:" + eqLower).block(BLOCK)).isNull();
            assertThat(redis.opsForHash().get("user:" + INTERNAL_ID, "walletAddress").block(BLOCK))
                    .isEqualTo(rawA);
            assertTtlNearNinetyDays("auth_wallet:" + rawA);
            assertTtlNearNinetyDays("user:" + INTERNAL_ID);
        }

        @Test
        @DisplayName("no linked wallet → 400-class error and no auth_wallet write")
        void noWalletLinkedDoesNotWrite() {
            String rawB = Address.of(WALLET_B_RAW).toRaw();
            redis.opsForHash()
                    .putAll("user:" + INTERNAL_ID, Map.of(
                            "internalId", INTERNAL_ID,
                            "authType", "TELEGRAM",
                            "displayName", "Alice",
                            "telegramId", String.valueOf(TELEGRAM_ID),
                            "walletAddress", "",
                            "avatarUrl", "",
                            "createdAt", "1"))
                    .block(BLOCK);

            StepVerifier.create(repository.switchWallet(INTERNAL_ID, rawB))
                    .expectErrorSatisfies(ex -> {
                        assertThat(ex).isInstanceOf(IllegalArgumentException.class);
                        assertThat(ex).hasMessage("No wallet linked");
                    })
                    .verify();

            assertThat(redis.opsForValue().get("auth_wallet:" + rawB).block(BLOCK)).isNull();
        }

        @Test
        @DisplayName("session_token:* is left intact after switch")
        void sessionTokenSurvivesSwitch() {
            String rawA = Address.of(WALLET_A_EQ).toRaw();
            String rawB = Address.of(WALLET_B_RAW).toRaw();
            seedLinkedUser(INTERNAL_ID, TELEGRAM_ID, rawA, "Alice", "TELEGRAM");
            redis.opsForValue().set("session_token:keep-me", INTERNAL_ID, Duration.ofHours(1)).block(BLOCK);

            StepVerifier.create(repository.switchWallet(INTERNAL_ID, rawB))
                    .verifyComplete();

            assertThat(redis.opsForValue().get("session_token:keep-me").block(BLOCK)).isEqualTo(INTERNAL_ID);
        }

        @Test
        @DisplayName("concurrent A→B and A→C leave one mapping and no orphan auth_wallet")
        void concurrentSwitchLeavesOneMappingNoOrphan() throws Exception {
            String rawA = Address.of(WALLET_A_EQ).toRaw();
            String rawB = Address.of(WALLET_B_RAW).toRaw();
            String rawC = Address.of(WALLET_C_RAW).toRaw();
            seedLinkedUser(INTERNAL_ID, TELEGRAM_ID, rawA, "Alice", "TELEGRAM");

            CountDownLatch start = new CountDownLatch(1);
            CountDownLatch done = new CountDownLatch(2);
            Thread switchToB = new Thread(() -> {
                await(start);
                repository.switchWallet(INTERNAL_ID, rawB).block(BLOCK);
                done.countDown();
            });
            Thread switchToC = new Thread(() -> {
                await(start);
                repository.switchWallet(INTERNAL_ID, rawC).block(BLOCK);
                done.countDown();
            });
            switchToB.start();
            switchToC.start();
            start.countDown();
            assertThat(done.await(10, TimeUnit.SECONDS)).isTrue();

            String stored = (String) redis.opsForHash().get("user:" + INTERNAL_ID, "walletAddress").block(BLOCK);
            assertThat(stored).isIn(rawB, rawC);
            assertThat(redis.opsForValue().get("auth_wallet:" + stored).block(BLOCK)).isEqualTo(INTERNAL_ID);
            assertThat(redis.opsForValue().get("auth_wallet:" + rawA).block(BLOCK)).isNull();
            String other = stored.equals(rawB) ? rawC : rawB;
            String otherOwner = redis.opsForValue().get("auth_wallet:" + other).block(BLOCK);
            assertThat(otherOwner).isNotEqualTo(INTERNAL_ID);
        }

        @Test
        @DisplayName("last-method unlink still rejected when wallet is the only sign-in method")
        void lastMethodUnlinkWalletStillRejected() {
            redis.opsForHash()
                    .putAll("user:" + INTERNAL_ID, Map.of(
                            "internalId", INTERNAL_ID,
                            "authType", "WALLET",
                            "displayName", "Alice",
                            "telegramId", "",
                            "walletAddress", Address.of(WALLET_A_EQ).toRaw(),
                            "avatarUrl", "",
                            "createdAt", "1"))
                    .block(BLOCK);

            StepVerifier.create(repository.unlinkWallet(INTERNAL_ID))
                    .expectErrorSatisfies(ex -> {
                        assertThat(ex).isInstanceOf(IllegalStateException.class);
                        assertThat(ex).hasMessage("Cannot unlink the last sign-in method");
                    })
                    .verify();
        }

        private void await(CountDownLatch latch) {
            try {
                assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(ex);
            }
        }

        private void assertTtlNearNinetyDays(String key) {
            Duration ttl = redis.getExpire(key).block(BLOCK);
            assertThat(ttl).isNotNull();
            assertThat(ttl.toDays()).isBetween(89L, 90L);
        }

        private void seedLinkedUser(
                String internalId,
                Long telegramId,
                String walletRaw,
                String displayName,
                String authType) {
            redis.opsForHash()
                    .putAll("user:" + internalId, Map.of(
                            "internalId", internalId,
                            "authType", authType,
                            "displayName", displayName,
                            "telegramId", String.valueOf(telegramId),
                            "walletAddress", walletRaw,
                            "avatarUrl", "",
                            "createdAt", "1"))
                    .then(redis.expire("user:" + internalId, Duration.ofDays(90)))
                    .then(redis.opsForValue().set("auth_wallet:" + walletRaw, internalId, Duration.ofDays(90)))
                    .then(redis.opsForValue().set("auth_tg:" + telegramId, internalId, Duration.ofDays(90)))
                    .block(BLOCK);
        }
    }
}

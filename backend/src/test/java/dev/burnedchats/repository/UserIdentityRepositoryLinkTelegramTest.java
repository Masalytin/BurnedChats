package dev.burnedchats.repository;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.ReactiveHashOperations;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.ReactiveValueOperations;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Duration;
import java.util.AbstractMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit contract for {@code linkTelegram}: first bind, refresh, absorb wallet-less stub, real 409.
 */
@DisplayName("UserIdentityRepository.linkTelegram")
@SuppressWarnings("checkstyle:HideUtilityClassConstructor")
class UserIdentityRepositoryLinkTelegramTest {

    private static final String WALLET_ID = "wallet-user-1";
    private static final String STUB_ID = "tg-stub-2";
    private static final String OTHER_WALLET_ID = "other-wallet-3";
    private static final long TELEGRAM_ID = 9_101_112L;
    private static final String WALLET_RAW =
            "0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String OTHER_WALLET_RAW =
            "0:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    @Nested
    @ExtendWith(MockitoExtension.class)
    @MockitoSettings(strictness = Strictness.LENIENT)
    @DisplayName("unit contract")
    class UnitContract {
        @Mock
        private ReactiveRedisTemplate<String, String> redisTemplate;
        @Mock
        private ReactiveValueOperations<String, String> valueOps;
        @Mock
        private ReactiveHashOperations<String, Object, Object> hashOps;

        private UserIdentityRepository repository;

        @BeforeEach
        void setUp() {
            when(redisTemplate.opsForValue()).thenReturn(valueOps);
            when(redisTemplate.opsForHash()).thenReturn(hashOps);
            repository = new UserIdentityRepository(redisTemplate);
        }

        @Test
        @DisplayName("auth_tg points at wallet-less Telegram stub → absorb onto wallet id")
        void absorbsWalletLessTelegramStub() {
            when(valueOps.get("auth_tg:" + TELEGRAM_ID)).thenReturn(Mono.just(STUB_ID));
            stubUserHash(STUB_ID, telegramStubHash());
            when(valueOps.set(eq("auth_tg:" + TELEGRAM_ID), eq(WALLET_ID), any(Duration.class)))
                    .thenReturn(Mono.just(true));
            when(hashOps.put("user:" + WALLET_ID, "telegramId", String.valueOf(TELEGRAM_ID)))
                    .thenReturn(Mono.just(true));
            when(redisTemplate.expire(eq("user:" + WALLET_ID), any(Duration.class)))
                    .thenReturn(Mono.just(true));

            StepVerifier.create(repository.linkTelegram(WALLET_ID, TELEGRAM_ID))
                    .verifyComplete();

            verify(valueOps).set(eq("auth_tg:" + TELEGRAM_ID), eq(WALLET_ID), any(Duration.class));
            verify(hashOps).put("user:" + WALLET_ID, "telegramId", String.valueOf(TELEGRAM_ID));
        }

        @Test
        @DisplayName("auth_tg points at an account that has a wallet → 409")
        void mappingToWalletBearingAccountConflicts() {
            when(valueOps.get("auth_tg:" + TELEGRAM_ID)).thenReturn(Mono.just(OTHER_WALLET_ID));
            stubUserHash(OTHER_WALLET_ID, walletUserHash(OTHER_WALLET_ID, OTHER_WALLET_RAW, TELEGRAM_ID));

            StepVerifier.create(repository.linkTelegram(WALLET_ID, TELEGRAM_ID))
                    .expectErrorSatisfies(ex -> {
                        assertThat(ex).isInstanceOf(IllegalStateException.class);
                        assertThat(ex).hasMessage("Telegram already linked to another account");
                    })
                    .verify();

            verify(valueOps, never()).set(eq("auth_tg:" + TELEGRAM_ID), eq(WALLET_ID), any(Duration.class));
        }

        @Test
        @DisplayName("auth_tg already this wallet → refresh OK")
        void mappingAlreadyThisWalletRefreshes() {
            when(valueOps.get("auth_tg:" + TELEGRAM_ID)).thenReturn(Mono.just(WALLET_ID));
            when(valueOps.set(eq("auth_tg:" + TELEGRAM_ID), eq(WALLET_ID), any(Duration.class)))
                    .thenReturn(Mono.just(true));
            when(hashOps.put("user:" + WALLET_ID, "telegramId", String.valueOf(TELEGRAM_ID)))
                    .thenReturn(Mono.just(true));
            when(redisTemplate.expire(eq("user:" + WALLET_ID), any(Duration.class)))
                    .thenReturn(Mono.just(true));

            StepVerifier.create(repository.linkTelegram(WALLET_ID, TELEGRAM_ID))
                    .verifyComplete();
        }

        @Test
        @DisplayName("no auth_tg mapping → bind telegram to wallet internalId")
        void noMappingBindsTelegram() {
            when(valueOps.get("auth_tg:" + TELEGRAM_ID)).thenReturn(Mono.empty());
            stubUserHash(WALLET_ID, walletUserHash(WALLET_ID, WALLET_RAW, null));
            when(valueOps.set(eq("auth_tg:" + TELEGRAM_ID), eq(WALLET_ID), any(Duration.class)))
                    .thenReturn(Mono.just(true));
            when(hashOps.put("user:" + WALLET_ID, "telegramId", String.valueOf(TELEGRAM_ID)))
                    .thenReturn(Mono.just(true));
            when(redisTemplate.expire(eq("user:" + WALLET_ID), any(Duration.class)))
                    .thenReturn(Mono.just(true));

            StepVerifier.create(repository.linkTelegram(WALLET_ID, TELEGRAM_ID))
                    .verifyComplete();

            verify(valueOps).set(eq("auth_tg:" + TELEGRAM_ID), eq(WALLET_ID), any(Duration.class));
        }

        private void stubUserHash(String internalId, Map<String, String> hash) {
            Flux<Map.Entry<Object, Object>> entries = Flux.fromIterable(hash.entrySet())
                    .map(e -> new AbstractMap.SimpleImmutableEntry<>(e.getKey(), e.getValue()));
            when(hashOps.entries("user:" + internalId)).thenReturn(entries);
        }

        private Map<String, String> telegramStubHash() {
            return Map.of(
                    "internalId", STUB_ID,
                    "authType", "TELEGRAM",
                    "displayName", "Stub",
                    "telegramId", String.valueOf(TELEGRAM_ID),
                    "walletAddress", "",
                    "avatarUrl", "",
                    "createdAt", "1");
        }

        private Map<String, String> walletUserHash(String internalId, String walletRaw, Long telegramId) {
            return Map.of(
                    "internalId", internalId,
                    "authType", "WALLET",
                    "displayName", "Wallet",
                    "telegramId", telegramId == null ? "" : String.valueOf(telegramId),
                    "walletAddress", walletRaw,
                    "avatarUrl", "",
                    "createdAt", "1");
        }
    }
}

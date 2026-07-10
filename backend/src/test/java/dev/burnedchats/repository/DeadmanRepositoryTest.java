package dev.burnedchats.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.repository.DeadmanRepository.DeadmanConfig;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.ReactiveValueOperations;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("DeadmanRepository")
class DeadmanRepositoryTest {

    private static final String USER_ID = "tg:123456789";

    @Mock
    private ReactiveRedisTemplate<String, String> redisTemplate;

    @Mock
    private ReactiveValueOperations<String, String> valueOperations;

    private DeadmanRepository repository;

    @BeforeEach
    void setUp() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        repository = new DeadmanRepository(redisTemplate, new ObjectMapper());
    }

    @Nested
    @DisplayName("key helpers")
    class KeyHelpers {

        @Test
        void isDeadmanTriggerKey_matchesTriggerOnly() {
            assertTrue(DeadmanRepository.isDeadmanTriggerKey("user:deadman:tg:1"));
            assertFalse(DeadmanRepository.isDeadmanTriggerKey("user:deadman:cfg:tg:1"));
            assertFalse(DeadmanRepository.isDeadmanTriggerKey("user:123"));
        }

        @Test
        void parseInternalIdFromDeadmanTriggerKey_extractsId() {
            assertEquals(USER_ID, DeadmanRepository.parseInternalIdFromDeadmanTriggerKey(
                    "user:deadman:" + USER_ID));
            assertNull(DeadmanRepository.parseInternalIdFromDeadmanTriggerKey("user:deadman:cfg:" + USER_ID));
        }
    }

    @Nested
    @DisplayName("enable")
    class Enable {

        @Test
        void enable_setsConfigWithoutTtlAndTriggerWithPeriodTtl() throws Exception {
            String cfgKey = "user:deadman:cfg:" + USER_ID;
            String triggerKey = "user:deadman:" + USER_ID;
            DeadmanConfig config = new DeadmanConfig(30, true);

            when(valueOperations.set(eq(cfgKey), anyString())).thenReturn(Mono.just(true));
            when(valueOperations.set(eq(triggerKey), eq(USER_ID), eq(Duration.ofDays(30))))
                    .thenReturn(Mono.just(true));
            when(redisTemplate.getExpire(triggerKey)).thenReturn(Mono.just(Duration.ofDays(30)));

            StepVerifier.create(repository.enable(USER_ID, config))
                    .assertNext(state -> {
                        assertTrue(state.enabled());
                        assertEquals(30, state.periodDays());
                        assertTrue(state.wipeIdentity());
                        assertTrue(state.expiresAt() > System.currentTimeMillis());
                    })
                    .verifyComplete();

            ArgumentCaptor<String> cfgJsonCaptor = ArgumentCaptor.forClass(String.class);
            verify(valueOperations).set(eq(cfgKey), cfgJsonCaptor.capture());
            DeadmanConfig stored = new ObjectMapper().readValue(cfgJsonCaptor.getValue(), DeadmanConfig.class);
            assertEquals(30, stored.periodDays());
            assertTrue(stored.wipeIdentity());
            verify(valueOperations).set(triggerKey, USER_ID, Duration.ofDays(30));
        }
    }

    @Nested
    @DisplayName("disable")
    class Disable {

        @Test
        void disable_deletesTriggerAndConfigKeys() {
            String cfgKey = "user:deadman:cfg:" + USER_ID;
            String triggerKey = "user:deadman:" + USER_ID;

            when(redisTemplate.delete(cfgKey)).thenReturn(Mono.just(1L));
            when(redisTemplate.delete(triggerKey)).thenReturn(Mono.just(1L));

            StepVerifier.create(repository.disable(USER_ID))
                    .assertNext(state -> {
                        assertFalse(state.enabled());
                        assertNull(state.periodDays());
                        assertFalse(state.wipeIdentity());
                        assertNull(state.expiresAt());
                    })
                    .verifyComplete();

            verify(redisTemplate).delete(cfgKey);
            verify(redisTemplate).delete(triggerKey);
        }
    }

    @Nested
    @DisplayName("refreshOnActivity")
    class RefreshOnActivity {

        @Test
        void refresh_resetsTriggerTtlWhenConfigExists() throws Exception {
            String cfgKey = "user:deadman:cfg:" + USER_ID;
            String triggerKey = "user:deadman:" + USER_ID;
            String cfgJson = new ObjectMapper().writeValueAsString(new DeadmanConfig(7, false));

            when(valueOperations.get(cfgKey)).thenReturn(Mono.just(cfgJson));
            when(redisTemplate.hasKey(triggerKey)).thenReturn(Mono.just(true));
            when(valueOperations.set(eq(triggerKey), eq(USER_ID), eq(Duration.ofDays(7))))
                    .thenReturn(Mono.just(true));

            StepVerifier.create(repository.refreshOnActivity(USER_ID))
                    .expectNext(true)
                    .verifyComplete();

            verify(valueOperations).set(triggerKey, USER_ID, Duration.ofDays(7));
        }

        @Test
        void refresh_noopsWhenConfigMissing() {
            when(valueOperations.get("user:deadman:cfg:" + USER_ID)).thenReturn(Mono.empty());

            StepVerifier.create(repository.refreshOnActivity(USER_ID))
                    .expectNext(false)
                    .verifyComplete();

            verify(valueOperations, never()).set(anyString(), anyString(), any(Duration.class));
        }
    }

    @Nested
    @DisplayName("getConfig / clearConfig")
    class ExpirePath {

        @Test
        void getConfig_readsStoredJson() throws Exception {
            String cfgKey = "user:deadman:cfg:" + USER_ID;
            String cfgJson = new ObjectMapper().writeValueAsString(new DeadmanConfig(90, true));
            when(valueOperations.get(cfgKey)).thenReturn(Mono.just(cfgJson));

            StepVerifier.create(repository.getConfig(USER_ID))
                    .assertNext(cfg -> {
                        assertEquals(90, cfg.periodDays());
                        assertTrue(cfg.wipeIdentity());
                    })
                    .verifyComplete();
        }

        @Test
        void clearConfig_deletesConfigKey() {
            String cfgKey = "user:deadman:cfg:" + USER_ID;
            when(redisTemplate.delete(cfgKey)).thenReturn(Mono.just(1L));

            StepVerifier.create(repository.clearConfig(USER_ID))
                    .expectNext(1L)
                    .verifyComplete();
        }
    }
}

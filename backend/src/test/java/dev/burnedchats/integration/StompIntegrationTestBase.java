package dev.burnedchats.integration;

import dev.burnedchats.model.TelegramUser;
import dev.burnedchats.security.TelegramAuthService;
import dev.burnedchats.security.TelegramInitData;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.time.Instant;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Shared Redis (Testcontainers) and mocked Telegram auth for STOMP integration tests.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles({ "test", "integration" })
@Testcontainers(disabledWithoutDocker = true)
public abstract class StompIntegrationTestBase {

    protected static final long DEFAULT_TELEGRAM_ID = 1001L;

    @Container
    @SuppressWarnings("resource")
    protected static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7-alpine"))
                    .withExposedPorts(6379);

    @DynamicPropertySource
    static void registerRedis(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379).toString());
    }

    @MockBean
    protected TelegramAuthService telegramAuthService;

    @LocalServerPort
    protected int serverPort;

    @BeforeEach
    void stubTelegramAuthDefault() {
        stubTelegramAuthForTgId(DEFAULT_TELEGRAM_ID);
    }

    protected void stubTelegramAuthForTgId(long telegramId) {
        TelegramUser user = TelegramUser.builder()
                .id(telegramId)
                .firstName("Integration")
                .username("itest")
                .build();
        TelegramInitData init = TelegramInitData.builder()
                .user(user)
                .authDate(Instant.now())
                .hash("integration-mock")
                .build();
        when(telegramAuthService.validateInitData(anyString())).thenReturn(init);
    }
}

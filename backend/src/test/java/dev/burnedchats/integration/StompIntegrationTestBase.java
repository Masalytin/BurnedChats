package dev.burnedchats.integration;

import dev.burnedchats.model.TelegramUser;
import dev.burnedchats.security.TelegramAuthService;
import dev.burnedchats.security.TelegramInitData;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.connection.ReactiveRedisConnection;
import org.springframework.data.redis.connection.ReactiveRedisConnectionFactory;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.DockerImageName;

import java.time.Duration;
import java.time.Instant;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Shared Redis (Testcontainers) and mocked Telegram auth for STOMP integration tests.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles({ "test", "integration" })
@EnabledIf("dev.burnedchats.integration.StompIntegrationTestBase#dockerAvailable")
public abstract class StompIntegrationTestBase {

    protected static final long DEFAULT_TELEGRAM_ID = 1001L;

    /**
     * Singleton Redis container shared across every STOMP IT class.
     *
     * <p>Started once in a static initializer and intentionally never stopped per
     * class: Testcontainers' JVM-shutdown reaper (Ryuk) reaps it. The previous
     * {@code @Container}/{@code @Testcontainers} lifecycle stopped the container
     * after the first IT class, then started a fresh one with a new mapped port
     * for the next class — but all IT classes share one cached Spring context
     * (same {@code @SpringBootTest} config). The cached context kept pointing at
     * the dead port → {@code Connection refused}. A singleton container keeps the
     * mapped port stable for the whole test JVM.
     */
    @SuppressWarnings("resource")
    protected static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7-alpine"))
                    .withExposedPorts(6379)
                    // Wait until redis-server is actually accepting connections.
                    // The default port-listening probe can pass before redis is ready
                    // on Docker Desktop (Windows npipe), causing the reactive Lettuce
                    // pool to fail context startup with "Connection closed prematurely".
                    .waitingFor(Wait.forLogMessage(".*Ready to accept connections.*\\n", 1)
                            .withStartupTimeout(Duration.ofSeconds(60)));

    static {
        if (dockerAvailable()) {
            REDIS.start();
        }
    }

    /** Gate the suite on Docker availability without the per-class Testcontainers extension. */
    public static boolean dockerAvailable() {
        return DockerClientFactory.instance().isDockerAvailable();
    }

    @DynamicPropertySource
    static void registerRedis(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379).toString());
    }

    @MockBean
    protected TelegramAuthService telegramAuthService;

    @Autowired
    private ReactiveRedisConnectionFactory redisConnectionFactory;

    @LocalServerPort
    protected int serverPort;

    @BeforeEach
    void resetRedisState() {
        // Singleton container is shared across all IT classes and methods; wipe keyspace
        // before each test so state (sessions, requests, file metadata) does not leak between tests.
        // In-process FLUSHALL (reactive) — execInContainer is pathologically slow on Docker Desktop.
        // The connection MUST be closed: leaking one per test eventually exhausts/breaks the Lettuce
        // pool, which then surfaces as RedisConnectionFailureException + failed WS handshakes mid-suite.
        ReactiveRedisConnection connection = redisConnectionFactory.getReactiveConnection();
        try {
            connection.serverCommands().flushAll().block(Duration.ofSeconds(10));
        } finally {
            connection.close();
        }
    }

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

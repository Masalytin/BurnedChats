package dev.burnedchats.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link MessagesProperties} (offline queue binding).
 */
class MessagesPropertiesTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(EnableProperties.class);

    @Configuration
    @EnableConfigurationProperties(MessagesProperties.class)
    static class EnableProperties {
    }

    @Test
    void shouldBindDefaultOfflineQueue() {
        contextRunner
                .withPropertyValues("burnedchats.messages.offline-queue.ttl=24h",
                        "burnedchats.messages.offline-queue.max-size-per-session=100",
                        "burnedchats.messages.offline-queue.max-size-per-room=500",
                        "burnedchats.messages.offline-queue.keyspace-listener-enabled=false")
                .run(ctx -> {
                    MessagesProperties p = ctx.getBean(MessagesProperties.class);
                    assertThat(p.getOfflineQueue().getTtl()).isEqualTo(Duration.ofHours(24));
                    assertThat(p.getOfflineQueue().getMaxSizePerSession()).isEqualTo(100);
                    assertThat(p.getOfflineQueue().getMaxSizePerRoom()).isEqualTo(500);
                    assertThat(p.getOfflineQueue().isKeyspaceListenerEnabled()).isFalse();
                });
    }
}

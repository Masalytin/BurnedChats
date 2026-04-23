package dev.burnedchats.config;

import dev.burnedchats.metrics.OfflineQueueKeyUtil;
import dev.burnedchats.metrics.OfflineQueueMetrics;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import java.nio.charset.StandardCharsets;

/**
 * Listens to Redis keyspace expirations for message list keys (requires
 * server {@code notify-keyspace-events} for expired, e.g. Ex / Ee).
 */
@Configuration
@ConditionalOnProperty(
        prefix = "burnedchats.messages.offline-queue",
        name = "keyspace-listener-enabled",
        havingValue = "true",
        matchIfMissing = true
)
public class OfflineQueueRedisKeyspaceConfig {

    @Bean(destroyMethod = "stop")
    public RedisMessageListenerContainer offlineMessageKeyspaceListenerContainer(
            RedisConnectionFactory connectionFactory,
            MessageListener offlineQueueExpiredMessageListener) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.addMessageListener(offlineQueueExpiredMessageListener, new PatternTopic("__keyevent@*__:expired"));
        return container;
    }

    @Bean
    public MessageListener offlineQueueExpiredMessageListener(OfflineQueueMetrics metrics) {
        return (message, pattern) -> {
            byte[] body = message.getBody();
            if (body == null) {
                return;
            }
            String key = new String(body, StandardCharsets.UTF_8);
            if (!OfflineQueueKeyUtil.isMessageListKey(key)) {
                return;
            }
            metrics.onListKeyExpired(key);
        };
    }
}

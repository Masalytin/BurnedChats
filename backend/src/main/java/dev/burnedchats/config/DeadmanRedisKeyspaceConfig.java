package dev.burnedchats.config;

import dev.burnedchats.repository.DeadmanRepository;
import dev.burnedchats.service.DeadmanService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

import java.nio.charset.StandardCharsets;

/**
 * Listens to Redis keyspace expirations on {@code user:deadman:{internalId}} trigger keys and
 * executes the burn-all cascade (requires server {@code notify-keyspace-events} for expired).
 */
@Slf4j
@Configuration
@ConditionalOnProperty(
        prefix = "burnedchats.users.deadman",
        name = "keyspace-listener-enabled",
        havingValue = "true",
        matchIfMissing = true
)
public class DeadmanRedisKeyspaceConfig {

    @Bean(destroyMethod = "stop")
    public RedisMessageListenerContainer deadmanKeyspaceListenerContainer(
            RedisConnectionFactory connectionFactory,
            MessageListener deadmanExpiredMessageListener) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.addMessageListener(deadmanExpiredMessageListener,
                new PatternTopic("__keyevent@*__:expired"));
        return container;
    }

    @Bean
    public MessageListener deadmanExpiredMessageListener(DeadmanService deadmanService) {
        return (message, pattern) -> {
            byte[] body = message.getBody();
            if (body == null) {
                return;
            }
            String key = new String(body, StandardCharsets.UTF_8);
            if (!DeadmanRepository.isDeadmanTriggerKey(key)) {
                return;
            }
            String internalId = DeadmanRepository.parseInternalIdFromDeadmanTriggerKey(key);
            if (internalId == null || internalId.isBlank()) {
                return;
            }
            LOG.info("Deadman trigger expired for user {}", internalId);
            deadmanService.onTriggerExpired(internalId)
                    .doOnError(err -> LOG.error("Deadman expiry handler failed for user {}: {}",
                            internalId, err.getMessage()))
                    .subscribe();
        };
    }
}

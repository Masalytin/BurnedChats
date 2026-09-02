package dev.burnedchats.config;

import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.service.PresenceFanoutService;
import dev.burnedchats.service.PresenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

import java.nio.charset.StandardCharsets;

/**
 * Redis listeners for DM presence: {@code online:*} TTL expiry and
 * {@code presence:fanout} cross-instance delivery.
 */
@Slf4j
@Configuration
@ConditionalOnProperty(
        prefix = "burnedchats.presence",
        name = "keyspace-listener-enabled",
        havingValue = "true",
        matchIfMissing = true
)
public class PresenceRedisKeyspaceConfig {

    @Bean(destroyMethod = "stop")
    public RedisMessageListenerContainer presenceKeyspaceListenerContainer(
            RedisConnectionFactory connectionFactory,
            MessageListener presenceOnlineExpiredMessageListener,
            MessageListener presenceFanoutMessageListener) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.addMessageListener(presenceOnlineExpiredMessageListener,
                new PatternTopic("__keyevent@*__:expired"));
        container.addMessageListener(presenceFanoutMessageListener,
                new ChannelTopic(PresenceFanoutService.REDIS_CHANNEL));
        return container;
    }

    @Bean
    public MessageListener presenceOnlineExpiredMessageListener(PresenceService presenceService) {
        return (message, pattern) -> {
            byte[] body = message.getBody();
            if (body == null) {
                return;
            }
            String key = new String(body, StandardCharsets.UTF_8);
            if (!OnlineStatusRepository.isOnlineKey(key)) {
                return;
            }
            String internalId = OnlineStatusRepository.parseInternalIdFromOnlineKey(key);
            if (internalId == null || internalId.isBlank()) {
                return;
            }
            LOG.debug("online:* expired: internalId={}", internalId);
            presenceService.onOnlineKeyExpired(internalId)
                    .doOnError(err -> LOG.warn("Presence TTL expire fan-out failed for {}: {}",
                            internalId, err.getMessage()))
                    .subscribe();
        };
    }

    @Bean
    public MessageListener presenceFanoutMessageListener(PresenceFanoutService fanout) {
        return (message, pattern) -> {
            byte[] body = message.getBody();
            if (body == null) {
                return;
            }
            fanout.deliverFromBus(new String(body, StandardCharsets.UTF_8));
        };
    }
}

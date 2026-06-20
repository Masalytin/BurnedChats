package dev.burnedchats.config;

import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.service.RoomService;
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
 * Listens to Redis keyspace expirations on {@code room:autoburn:{roomId}} trigger keys and
 * executes the full room burn cascade (requires server {@code notify-keyspace-events} for
 * expired, e.g. {@code Ex} / {@code Ee}).
 */
@Slf4j
@Configuration
@ConditionalOnProperty(
        prefix = "burnedchats.rooms.autoburn",
        name = "keyspace-listener-enabled",
        havingValue = "true",
        matchIfMissing = true
)
public class RoomAutoBurnRedisKeyspaceConfig {

    @Bean(destroyMethod = "stop")
    public RedisMessageListenerContainer roomAutoBurnKeyspaceListenerContainer(
            RedisConnectionFactory connectionFactory,
            MessageListener roomAutoBurnExpiredMessageListener) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.addMessageListener(roomAutoBurnExpiredMessageListener,
                new PatternTopic("__keyevent@*__:expired"));
        return container;
    }

    @Bean
    public MessageListener roomAutoBurnExpiredMessageListener(RoomService roomService) {
        return (message, pattern) -> {
            byte[] body = message.getBody();
            if (body == null) {
                return;
            }
            String key = new String(body, StandardCharsets.UTF_8);
            if (!RoomRepository.isAutoBurnTriggerKey(key)) {
                return;
            }
            String roomId = RoomRepository.parseRoomIdFromAutoBurnKey(key);
            if (roomId == null || roomId.isBlank()) {
                return;
            }
            LOG.info("Auto-burn trigger expired for room {}", roomId);
            roomService.executeAutoBurnAndNotify(roomId)
                    .doOnError(err -> LOG.error("Auto-burn failed for room {}: {}", roomId, err.getMessage()))
                    .subscribe();
        };
    }
}

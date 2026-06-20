package dev.burnedchats.config;

import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.DependsOn;
import org.springframework.messaging.simp.broker.SimpleBrokerMessageHandler;
import org.springframework.messaging.simp.broker.SubscriptionRegistry;

/**
 * Exposes the simple STOMP broker's {@link SubscriptionRegistry} for
 * {@link dev.burnedchats.service.RoomTopicSubscriptionService} (IMP-ROOM-25).
 *
 * <p>The registry is owned by {@link SimpleBrokerMessageHandler}; it is not a
 * standalone Spring bean until wired here after the broker handler starts.
 */
@Configuration
public class StompSubscriptionRegistryConfig {

    @Bean
    @DependsOn("simpleBrokerMessageHandler")
    SubscriptionRegistry subscriptionRegistry(ApplicationContext applicationContext) {
        return applicationContext.getBean(SimpleBrokerMessageHandler.class).getSubscriptionRegistry();
    }
}

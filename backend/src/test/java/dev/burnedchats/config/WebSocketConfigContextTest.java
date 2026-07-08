package dev.burnedchats.config;

import dev.burnedchats.handler.WebSocketExceptionHandler;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.security.RateLimitInterceptor;
import dev.burnedchats.security.RoomTopicSubscribeInterceptor;
import dev.burnedchats.security.StompAuthInterceptor;
import dev.burnedchats.security.StompHandshakeAuthInterceptor;
import dev.burnedchats.security.StompPrincipalHandshakeHandler;
import dev.burnedchats.service.RateLimitService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * Regression test for the startup bean cycle introduced in IMP-WSRL-01:
 * {@code rateLimitInterceptor} → {@code stompUserMessenger} → broker configuration
 * → {@code webSocketConfig} → {@code rateLimitInterceptor}.
 *
 * <p>Wires the real {@link WebSocketConfig}, {@link RateLimitInterceptor} and
 * {@link StompUserMessenger} beans (the cycle participants) with mocked leaf
 * dependencies. Fails with {@code BeanCurrentlyInCreationException} if the
 * {@code @Lazy} injection of {@code StompUserMessenger} is removed.
 */
class WebSocketConfigContextTest {

    private final WebApplicationContextRunner contextRunner = new WebApplicationContextRunner()
            .withUserConfiguration(WebSocketConfig.class)
            .withBean(RateLimitInterceptor.class)
            .withBean(StompUserMessenger.class)
            .withBean(RateLimitService.class, () -> mock(RateLimitService.class))
            .withBean(WebSocketExceptionHandler.class, () -> mock(WebSocketExceptionHandler.class))
            .withBean(StompAuthInterceptor.class, () -> mock(StompAuthInterceptor.class))
            .withBean(StompHandshakeAuthInterceptor.class, () -> mock(StompHandshakeAuthInterceptor.class))
            .withBean(StompPrincipalHandshakeHandler.class, () -> mock(StompPrincipalHandshakeHandler.class))
            .withBean(RoomTopicSubscribeInterceptor.class, () -> mock(RoomTopicSubscribeInterceptor.class));

    @Test
    void contextStartsWithoutBeanCycle() {
        contextRunner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).hasSingleBean(RateLimitInterceptor.class);
            assertThat(context).hasSingleBean(StompUserMessenger.class);
        });
    }
}

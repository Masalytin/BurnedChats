package dev.burnedchats.metrics;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

/**
 * ZK-safe STOMP delivery counters: destinations and result codes only, never payload.
 */
@Component
public class StompDeliveryMetrics {

    private final Counter sendAccepted;
    private final Counter sendDropped;
    private final Counter rateLimitHits;

    public StompDeliveryMetrics(MeterRegistry registry) {
        this.sendAccepted = Counter.builder("stomp.send.accepted")
                .description("STOMP SEND frames that passed rate limit")
                .register(registry);
        this.sendDropped = Counter.builder("stomp.send.dropped")
                .description("STOMP SEND frames dropped (rate limit)")
                .register(registry);
        this.rateLimitHits = Counter.builder("rate_limit.hits")
                .description("Rate-limit rejections")
                .register(registry);
    }

    public void incrementAccepted() {
        sendAccepted.increment();
    }

    public void incrementDropped() {
        sendDropped.increment();
        rateLimitHits.increment();
    }
}

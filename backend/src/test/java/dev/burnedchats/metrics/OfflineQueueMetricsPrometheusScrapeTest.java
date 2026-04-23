package dev.burnedchats.metrics;

import io.micrometer.core.instrument.Meter;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Smoke test: {@link OfflineQueueMetrics} registers expected meter ids (also exported via Actuator Prometheus).
 */
class OfflineQueueMetricsPrometheusScrapeTest {

    @Test
    void registersOfflineQueueMeters() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        new OfflineQueueMetrics(registry);
        assertThat(registry.getMeters())
                .extracting(Meter::getId)
                .anyMatch(id -> id.getName().equals(OfflineQueueMetrics.METRIC_ENQUEUED)
                        && id.getTag(OfflineQueueMetrics.TAG_SESSION_TYPE) != null);
    }
}

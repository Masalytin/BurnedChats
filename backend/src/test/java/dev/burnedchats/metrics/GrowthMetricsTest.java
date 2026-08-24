package dev.burnedchats.metrics;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Meter;
import io.micrometer.core.instrument.Tag;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class GrowthMetricsTest {

    @Test
    void countersAreMonotonicAndHaveNoIdentityTags() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        GrowthMetrics metrics = new GrowthMetrics(registry);

        metrics.incrementRoomsCreated();
        metrics.incrementRoomsCreated();
        metrics.incrementSessionsCreated();
        metrics.incrementDmInvitesRedeemed();
        metrics.incrementBotNotifySent("room_message");
        metrics.incrementBotNotifySent("room_join_request");

        assertThat(registry.counter(GrowthMetrics.ROOMS_CREATED).count()).isEqualTo(2.0);
        assertThat(registry.counter(GrowthMetrics.SESSIONS_CREATED).count()).isEqualTo(1.0);
        assertThat(registry.counter(GrowthMetrics.DM_INVITES_REDEEMED).count()).isEqualTo(1.0);
        assertThat(registry.counter(GrowthMetrics.BOT_NOTIFY_SENT, GrowthMetrics.TAG_TYPE, "room_message").count())
                .isEqualTo(1.0);
        assertThat(registry.counter(GrowthMetrics.BOT_NOTIFY_SENT, GrowthMetrics.TAG_TYPE, "room_join_request").count())
                .isEqualTo(1.0);

        for (Meter meter : registry.getMeters()) {
            if (!meter.getId().getName().startsWith("burnedchats.")
                    && !meter.getId().getName().equals(GrowthMetrics.ROOMS_CREATED)
                    && !meter.getId().getName().equals(GrowthMetrics.SESSIONS_CREATED)
                    && !meter.getId().getName().equals(GrowthMetrics.DM_INVITES_REDEEMED)
                    && !meter.getId().getName().equals(GrowthMetrics.BOT_NOTIFY_SENT)) {
                continue;
            }
            assertThat(meter.getId().getTags())
                    .extracting(Tag::getKey)
                    .doesNotContain("user", "userId", "internalId", "internal_id");
        }
        assertThat(registry.find(GrowthMetrics.ROOMS_CREATED).counters())
                .extracting(Counter::count)
                .containsExactly(2.0);
    }
}
